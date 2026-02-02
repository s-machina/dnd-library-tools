#!/usr/bin/env node

/**
 * SQLite FTS5 Full-Text Search for 5etools book data
 *
 * Usage:
 *   node src/index.js build <data-path>              Build search index
 *   node src/index.js search <query>                 Search all books
 *   node src/index.js search <query> --book <id>     Search specific book
 *   node src/index.js search <query> --limit <n>     Limit results
 */

import Database from 'better-sqlite3';
import { readFile, readdir, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, '..', 'library');
const DB_PATH = join(INDEX_DIR, 'search.db');

// Strip 5etools tags and extract plain text
function stripTags(text) {
  if (typeof text !== 'string') return '';

  // Remove various 5etools tags, keeping the display text
  return text
    .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1')
    .replace(/\{@\w+\}/g, '')
    .trim();
}

// Recursively extract text content from entries
function extractContent(entries, depth = 0) {
  if (!entries) return '';
  if (typeof entries === 'string') return stripTags(entries);

  if (Array.isArray(entries)) {
    return entries.map(e => extractContent(e, depth)).filter(Boolean).join('\n');
  }

  if (typeof entries === 'object') {
    const parts = [];

    if (entries.name) {
      parts.push(stripTags(entries.name));
    }

    if (entries.entries) {
      parts.push(extractContent(entries.entries, depth + 1));
    }

    if (entries.entry) {
      parts.push(extractContent(entries.entry, depth + 1));
    }

    if (entries.items) {
      parts.push(extractContent(entries.items, depth + 1));
    }

    // Handle table rows
    if (entries.rows) {
      for (const row of entries.rows) {
        if (Array.isArray(row)) {
          parts.push(row.map(cell => extractContent(cell, depth + 1)).join(' | '));
        }
      }
    }

    // Handle colLabels for tables
    if (entries.colLabels) {
      parts.push(entries.colLabels.map(stripTags).join(' | '));
    }

    return parts.filter(Boolean).join('\n');
  }

  return '';
}

// Extract all sections with their content
function extractSections(data, bookId, bookName) {
  const sections = [];

  function processEntry(entry, path = [], depth = 0) {
    if (typeof entry !== 'object' || !entry) return;

    if (entry.name) {
      const currentPath = [...path, entry.name];
      const content = extractContent(entry.entries || entry.entry);

      if (content.length > 0) {
        sections.push({
          bookId,
          bookName,
          sectionId: entry.id || null,
          sectionName: entry.name,
          sectionPath: currentPath.join(' > '),
          page: entry.page || null,
          depth,
          content,
        });
      }

      // Process nested entries
      if (entry.entries && Array.isArray(entry.entries)) {
        for (const nested of entry.entries) {
          if (typeof nested === 'object' && nested.name) {
            processEntry(nested, currentPath, depth + 1);
          }
        }
      }
    }
  }

  if (Array.isArray(data)) {
    for (const entry of data) {
      processEntry(entry);
    }
  }

  return sections;
}

// Build the search index
async function buildIndex(dataPath) {
  console.log('Building search index...\n');

  const booksDir = join(dataPath, 'data', 'book');
  const booksJsonPath = join(dataPath, 'data', 'books.json');

  // Load book metadata
  const booksMetaContent = await readFile(booksJsonPath, 'utf-8');
  const booksMeta = JSON.parse(booksMetaContent).book;
  const bookLookup = {};
  for (const book of booksMeta) {
    bookLookup[book.id.toLowerCase()] = book;
  }

  // Ensure directory exists
  try {
    await access(INDEX_DIR);
  } catch {
    await mkdir(INDEX_DIR, { recursive: true });
  }

  // Create database
  const db = new Database(DB_PATH);

  // Enable FTS5
  db.exec(`
    DROP TABLE IF EXISTS sections;
    DROP TABLE IF EXISTS sections_fts;

    CREATE TABLE sections (
      id INTEGER PRIMARY KEY,
      book_id TEXT NOT NULL,
      book_name TEXT NOT NULL,
      section_id TEXT,
      section_name TEXT NOT NULL,
      section_path TEXT NOT NULL,
      page INTEGER,
      depth INTEGER,
      content TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE sections_fts USING fts5(
      section_name,
      section_path,
      content,
      content='sections',
      content_rowid='id'
    );
  `);

  const insert = db.prepare(`
    INSERT INTO sections (book_id, book_name, section_id, section_name, section_path, page, depth, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Process each book
  const bookFiles = await readdir(booksDir);
  let totalSections = 0;

  const insertMany = db.transaction((sections) => {
    for (const section of sections) {
      insert.run(
        section.bookId,
        section.bookName,
        section.sectionId,
        section.sectionName,
        section.sectionPath,
        section.page,
        section.depth,
        section.content
      );
    }
  });

  for (const file of bookFiles) {
    if (!file.endsWith('.json')) continue;

    const bookId = file.replace('book-', '').replace('.json', '');
    const bookPath = join(booksDir, file);

    const meta = bookLookup[bookId] || { name: bookId.toUpperCase() };
    console.log(`Indexing: ${meta.name}`);

    const content = await readFile(bookPath, 'utf-8');
    const book = JSON.parse(content);

    const sections = extractSections(book.data, bookId, meta.name);
    insertMany(sections);
    totalSections += sections.length;
  }

  // Populate FTS index
  db.exec(`
    INSERT INTO sections_fts (rowid, section_name, section_path, content)
    SELECT id, section_name, section_path, content FROM sections;
  `);

  // Create regular indexes for filtering
  db.exec(`
    CREATE INDEX idx_sections_book ON sections(book_id);
    CREATE INDEX idx_sections_page ON sections(page);
  `);

  db.close();

  console.log(`\nIndex saved to: ${DB_PATH}`);
  console.log(`Books indexed: ${bookFiles.filter(f => f.endsWith('.json')).length}`);
  console.log(`Total sections: ${totalSections}`);
}

// Search the index
async function search(query, options = {}) {
  const { book, limit = 20 } = options;

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (error) {
    console.error('No search index found. Run: node src/index.js build <data-path>');
    process.exit(1);
  }

  // Build the search query
  // FTS5 query with BM25 ranking
  let sql = `
    SELECT
      s.book_id,
      s.book_name,
      s.section_name,
      s.section_path,
      s.page,
      snippet(sections_fts, 2, '>>>', '<<<', '...', 40) as snippet,
      bm25(sections_fts) as rank
    FROM sections_fts
    JOIN sections s ON sections_fts.rowid = s.id
    WHERE sections_fts MATCH ?
  `;

  const params = [query];

  if (book) {
    sql += ` AND s.book_id = ?`;
    params.push(book.toLowerCase());
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  try {
    const results = db.prepare(sql).all(...params);

    if (results.length === 0) {
      console.log(`No results found for: ${query}`);
      db.close();
      return;
    }

    console.log(`\nFound ${results.length} results for "${query}":\n`);

    for (const row of results) {
      const page = row.page ? ` (p.${row.page})` : '';
      console.log(`[${row.book_id}] ${row.section_path}${page}`);
      console.log(`  ${row.snippet.replace(/\n/g, ' ')}`);
      console.log('');
    }
  } catch (error) {
    if (error.message.includes('syntax error')) {
      // Try with quoted phrase for exact match
      const quotedQuery = `"${query}"`;
      params[0] = quotedQuery;
      try {
        const results = db.prepare(sql).all(...params);
        if (results.length === 0) {
          console.log(`No results found for: ${query}`);
        } else {
          console.log(`\nFound ${results.length} results for "${query}":\n`);
          for (const row of results) {
            const page = row.page ? ` (p.${row.page})` : '';
            console.log(`[${row.book_id}] ${row.section_path}${page}`);
            console.log(`  ${row.snippet.replace(/\n/g, ' ')}`);
            console.log('');
          }
        }
      } catch {
        console.error(`Search error: ${error.message}`);
      }
    } else {
      console.error(`Search error: ${error.message}`);
    }
  }

  db.close();
}

// Get full content of a section
async function getSection(bookId, sectionPath) {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (error) {
    console.error('No search index found. Run: node src/index.js build <data-path>');
    process.exit(1);
  }

  const result = db.prepare(`
    SELECT * FROM sections
    WHERE book_id = ? AND (section_path LIKE ? OR section_name LIKE ?)
    LIMIT 1
  `).get(bookId.toLowerCase(), `%${sectionPath}%`, `%${sectionPath}%`);

  if (result) {
    console.log(`\n[${result.book_id}] ${result.section_path}`);
    if (result.page) console.log(`Page: ${result.page}`);
    console.log('---');
    console.log(result.content);
  } else {
    console.error(`Section not found: ${sectionPath} in ${bookId}`);
  }

  db.close();
}

// Show index stats
async function stats() {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (error) {
    console.error('No search index found. Run: node src/index.js build <data-path>');
    process.exit(1);
  }

  const bookStats = db.prepare(`
    SELECT book_id, book_name, COUNT(*) as sections, SUM(LENGTH(content)) as total_chars
    FROM sections
    GROUP BY book_id
    ORDER BY book_name
  `).all();

  console.log('\nSearch Index Statistics:\n');
  console.log('ID'.padEnd(12) + 'Sections'.padEnd(10) + 'Size'.padEnd(10) + 'Name');
  console.log('-'.repeat(70));

  let totalSections = 0;
  let totalChars = 0;

  for (const book of bookStats) {
    const sizeKb = Math.round(book.total_chars / 1024);
    console.log(
      `${book.book_id.padEnd(12)}${String(book.sections).padEnd(10)}${(sizeKb + 'KB').padEnd(10)}${book.book_name}`
    );
    totalSections += book.sections;
    totalChars += book.total_chars;
  }

  console.log('-'.repeat(70));
  console.log(`Total: ${bookStats.length} books, ${totalSections} sections, ${Math.round(totalChars / 1024)}KB`);

  db.close();
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'build':
      const dataPath = args[1] || process.env.FIVETOOLS_DATA || './5etools-data';
      await buildIndex(dataPath);
      break;

    case 'search':
      if (!args[1]) {
        console.error('Usage: node src/index.js search <query> [--book <id>] [--limit <n>]');
        process.exit(1);
      }

      const queryParts = [];
      const options = {};

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--book' && args[i + 1]) {
          options.book = args[++i];
        } else if (args[i] === '--limit' && args[i + 1]) {
          options.limit = parseInt(args[++i]);
        } else if (!args[i].startsWith('--')) {
          queryParts.push(args[i]);
        }
      }

      await search(queryParts.join(' '), options);
      break;

    case 'get':
      if (!args[1] || !args[2]) {
        console.error('Usage: node src/index.js get <book-id> <section-name>');
        process.exit(1);
      }
      await getSection(args[1], args.slice(2).join(' '));
      break;

    case 'stats':
      await stats();
      break;

    default:
      console.log(`
D&D Library Search Tool (SQLite FTS5)

Usage:
  node src/index.js build <data-path>              Build search index
  node src/index.js search <query>                 Search all books
  node src/index.js search <query> --book <id>     Search specific book
  node src/index.js search <query> --limit <n>     Limit results (default: 20)
  node src/index.js get <book-id> <section>        Get full section content
  node src/index.js stats                          Show index statistics

Examples:
  node src/index.js build ./5etools-data
  node src/index.js search "fireball damage"
  node src/index.js search concentration --book xphb
  node src/index.js get xphb "Grappling"
`);
  }
}

main().catch(console.error);
