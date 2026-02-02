#!/usr/bin/env node

/**
 * Table of Contents tool for 5etools book data
 *
 * Usage:
 *   node src/toc.js build <data-path>           Build TOC index
 *   node src/toc.js list <book-id>              List chapters in a book
 *   node src/toc.js find <query>                Find sections by name
 *   node src/toc.js get <book-id> <section>     Extract section content
 */

import { readFile, writeFile, readdir, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, '..', 'library');
const INDEX_FILE = join(INDEX_DIR, 'toc-index.json');

// Extract text content from entries for searching
function extractText(entries) {
  if (!entries) return '';
  if (typeof entries === 'string') return entries;
  if (Array.isArray(entries)) {
    return entries.map(extractText).join(' ');
  }
  if (typeof entries === 'object') {
    const parts = [];
    if (entries.name) parts.push(entries.name);
    if (entries.entries) parts.push(extractText(entries.entries));
    if (entries.entry) parts.push(extractText(entries.entry));
    if (entries.items) parts.push(extractText(entries.items));
    return parts.join(' ');
  }
  return '';
}

// Recursively extract sections from book data
function extractSections(data, bookId, depth = 0, parentPath = []) {
  const sections = [];

  if (!Array.isArray(data)) return sections;

  for (const entry of data) {
    if (typeof entry !== 'object' || !entry.name) continue;

    const section = {
      bookId,
      id: entry.id || null,
      name: entry.name,
      page: entry.page || null,
      depth,
      path: [...parentPath, entry.name],
      type: entry.type || 'section',
      hasContent: !!(entry.entries && entry.entries.length > 0),
      contentSize: JSON.stringify(entry).length,
    };

    sections.push(section);

    // Recursively process nested entries
    if (entry.entries) {
      const nested = entry.entries.filter(e => typeof e === 'object' && e.name);
      if (nested.length > 0) {
        sections.push(...extractSections(nested, bookId, depth + 1, section.path));
      }
    }
  }

  return sections;
}

// Build TOC index from all books
async function buildIndex(dataPath) {
  const booksDir = join(dataPath, 'data', 'book');
  const booksJsonPath = join(dataPath, 'data', 'books.json');

  // Load book metadata
  const booksMetaContent = await readFile(booksJsonPath, 'utf-8');
  const booksMeta = JSON.parse(booksMetaContent).book;
  const bookLookup = {};
  for (const book of booksMeta) {
    bookLookup[book.id.toLowerCase()] = book;
  }

  // Process each book
  const bookFiles = await readdir(booksDir);
  const index = {
    books: {},
    sections: [],
    generated: new Date().toISOString(),
  };

  for (const file of bookFiles) {
    if (!file.endsWith('.json')) continue;

    const bookId = file.replace('book-', '').replace('.json', '');
    const bookPath = join(booksDir, file);

    console.log(`Processing: ${bookId}`);

    const content = await readFile(bookPath, 'utf-8');
    const book = JSON.parse(content);

    const meta = bookLookup[bookId] || { name: bookId.toUpperCase() };
    index.books[bookId] = {
      id: bookId,
      name: meta.name,
      published: meta.published,
      sectionCount: 0,
    };

    const sections = extractSections(book.data, bookId);
    index.books[bookId].sectionCount = sections.length;
    index.sections.push(...sections);
  }

  // Ensure directory exists
  try {
    await access(INDEX_DIR);
  } catch {
    await mkdir(INDEX_DIR, { recursive: true });
  }

  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(`\nIndex saved to: ${INDEX_FILE}`);
  console.log(`Books indexed: ${Object.keys(index.books).length}`);
  console.log(`Total sections: ${index.sections.length}`);

  return index;
}

// Load existing index
async function loadIndex() {
  try {
    const content = await readFile(INDEX_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('No index found. Run: node src/toc.js build <data-path>');
    process.exit(1);
  }
}

// List chapters/sections in a book
async function listBook(bookId) {
  const index = await loadIndex();
  const bid = bookId.toLowerCase();

  if (!index.books[bid]) {
    console.error(`Book not found: ${bookId}`);
    console.log('Available books:', Object.keys(index.books).join(', '));
    process.exit(1);
  }

  const book = index.books[bid];
  const sections = index.sections.filter(s => s.bookId === bid);

  console.log(`\n${book.name}\n${'='.repeat(book.name.length)}\n`);

  for (const section of sections) {
    const indent = '  '.repeat(section.depth);
    const page = section.page ? ` (p.${section.page})` : '';
    const size = section.contentSize > 1024
      ? `${Math.round(section.contentSize / 1024)}KB`
      : `${section.contentSize}B`;
    console.log(`${indent}${section.name}${page} [${size}]`);
  }

  console.log(`\nTotal sections: ${sections.length}`);
}

// Find sections by name (fuzzy match)
async function findSections(query, bookFilter = null) {
  const index = await loadIndex();
  const queryLower = query.toLowerCase();

  let sections = index.sections;
  if (bookFilter) {
    sections = sections.filter(s => s.bookId === bookFilter.toLowerCase());
  }

  const matches = sections.filter(s =>
    s.name.toLowerCase().includes(queryLower) ||
    s.path.some(p => p.toLowerCase().includes(queryLower))
  );

  if (matches.length === 0) {
    console.log(`No sections found matching: ${query}`);
    return;
  }

  console.log(`\nFound ${matches.length} sections matching "${query}":\n`);

  for (const section of matches) {
    const book = index.books[section.bookId];
    const page = section.page ? ` (p.${section.page})` : '';
    const path = section.path.join(' > ');
    console.log(`[${section.bookId}] ${path}${page}`);
  }
}

// Get section content from book
async function getSection(bookId, sectionQuery, dataPath) {
  const index = await loadIndex();
  const bid = bookId.toLowerCase();

  if (!index.books[bid]) {
    console.error(`Book not found: ${bookId}`);
    process.exit(1);
  }

  // Find matching section
  const queryLower = sectionQuery.toLowerCase();
  const sections = index.sections.filter(s => s.bookId === bid);
  const match = sections.find(s =>
    s.name.toLowerCase() === queryLower ||
    s.name.toLowerCase().includes(queryLower)
  );

  if (!match) {
    console.error(`Section not found: ${sectionQuery}`);
    console.log('Try: node src/toc.js list', bookId);
    process.exit(1);
  }

  // Load the book and extract the section
  const bookPath = join(dataPath, 'data', 'book', `book-${bid}.json`);
  const content = await readFile(bookPath, 'utf-8');
  const book = JSON.parse(content);

  // Find the section in the book data
  function findInData(data, targetName) {
    if (!Array.isArray(data)) return null;
    for (const entry of data) {
      if (typeof entry !== 'object') continue;
      if (entry.name && entry.name.toLowerCase() === targetName.toLowerCase()) {
        return entry;
      }
      if (entry.entries) {
        const found = findInData(entry.entries, targetName);
        if (found) return found;
      }
    }
    return null;
  }

  const section = findInData(book.data, match.name);

  if (section) {
    console.log(JSON.stringify(section, null, 2));
  } else {
    console.error('Could not extract section content');
  }
}

// List all indexed books
async function listBooks() {
  const index = await loadIndex();

  console.log('\nIndexed Books:\n');
  console.log('ID'.padEnd(12) + 'Sections'.padEnd(10) + 'Name');
  console.log('-'.repeat(60));

  for (const [id, book] of Object.entries(index.books)) {
    console.log(`${id.padEnd(12)}${String(book.sectionCount).padEnd(10)}${book.name}`);
  }

  console.log(`\nTotal: ${Object.keys(index.books).length} books, ${index.sections.length} sections`);
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

    case 'list':
      if (args[1]) {
        await listBook(args[1]);
      } else {
        await listBooks();
      }
      break;

    case 'find':
      if (!args[1]) {
        console.error('Usage: node src/toc.js find <query> [--book <id>]');
        process.exit(1);
      }
      const bookFilter = args.indexOf('--book') > -1 ? args[args.indexOf('--book') + 1] : null;
      await findSections(args[1], bookFilter);
      break;

    case 'get':
      if (!args[1] || !args[2]) {
        console.error('Usage: node src/toc.js get <book-id> <section-name> [data-path]');
        process.exit(1);
      }
      const getDataPath = args[3] || process.env.FIVETOOLS_DATA || './5etools-data';
      await getSection(args[1], args[2], getDataPath);
      break;

    default:
      console.log(`
D&D Library TOC Tool

Usage:
  node src/toc.js build <data-path>           Build TOC index from books
  node src/toc.js list                        List all indexed books
  node src/toc.js list <book-id>              List sections in a book
  node src/toc.js find <query>                Find sections by name
  node src/toc.js find <query> --book <id>    Find in specific book
  node src/toc.js get <book-id> <section>     Extract section JSON

Examples:
  node src/toc.js build ./5etools-data
  node src/toc.js list xphb
  node src/toc.js find "grappling"
  node src/toc.js get xphb "Playing the Game"
`);
  }
}

main().catch(console.error);
