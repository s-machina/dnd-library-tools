/**
 * Library search functions - shared between CLI and MCP server
 */

import Database from 'better-sqlite3';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'library', 'search.db');
const DEFAULT_TOC_PATH = join(__dirname, '..', '..', 'library', 'toc-index.json');

/**
 * Search the library for matching content
 * @param {string} query - Search query
 * @param {object} options - Search options
 * @param {string} [options.book] - Filter to specific book ID
 * @param {number} [options.limit=20] - Maximum results
 * @param {string} [options.dbPath] - Path to search database
 * @returns {Array} Search results with snippets
 */
export function searchLibrary(query, options = {}) {
  const { book, limit = 20, dbPath = DEFAULT_DB_PATH } = options;

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (error) {
    throw new Error(`Search index not found at ${dbPath}. Run: node src/index.js build`);
  }

  try {
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

    const results = db.prepare(sql).all(...params);
    return results.map(row => ({
      bookId: row.book_id,
      bookName: row.book_name,
      sectionName: row.section_name,
      sectionPath: row.section_path,
      page: row.page,
      snippet: row.snippet,
      rank: row.rank,
    }));
  } catch (error) {
    // Try quoted phrase if FTS5 syntax error
    if (error.message.includes('syntax error')) {
      const quotedQuery = `"${query}"`;
      return searchLibrary(quotedQuery, { ...options, dbPath });
    }
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Get full content of a section
 * @param {string} bookId - Book identifier
 * @param {string} sectionQuery - Section name or path to match
 * @param {object} options - Options
 * @param {string} [options.dbPath] - Path to search database
 * @returns {object|null} Section content or null if not found
 */
export function getSection(bookId, sectionQuery, options = {}) {
  const { dbPath = DEFAULT_DB_PATH } = options;

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (error) {
    throw new Error(`Search index not found at ${dbPath}. Run: node src/index.js build`);
  }

  try {
    const result = db.prepare(`
      SELECT * FROM sections
      WHERE book_id = ? AND (section_path LIKE ? OR section_name LIKE ?)
      LIMIT 1
    `).get(bookId.toLowerCase(), `%${sectionQuery}%`, `%${sectionQuery}%`);

    if (!result) return null;

    return {
      bookId: result.book_id,
      bookName: result.book_name,
      sectionId: result.section_id,
      sectionName: result.section_name,
      sectionPath: result.section_path,
      page: result.page,
      depth: result.depth,
      content: result.content,
    };
  } finally {
    db.close();
  }
}

/**
 * List all books in the index
 * @param {object} options - Options
 * @param {string} [options.dbPath] - Path to search database
 * @returns {Array} List of books with stats
 */
export function listBooks(options = {}) {
  const { dbPath = DEFAULT_DB_PATH } = options;

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (error) {
    throw new Error(`Search index not found at ${dbPath}. Run: node src/index.js build`);
  }

  try {
    const results = db.prepare(`
      SELECT book_id, book_name, COUNT(*) as sections, SUM(LENGTH(content)) as total_chars
      FROM sections
      GROUP BY book_id
      ORDER BY book_name
    `).all();

    return results.map(row => ({
      id: row.book_id,
      name: row.book_name,
      sections: row.sections,
      sizeBytes: row.total_chars,
    }));
  } finally {
    db.close();
  }
}

/**
 * Get table of contents for a book
 * @param {string} bookId - Book identifier
 * @param {object} options - Options
 * @param {string} [options.tocPath] - Path to TOC index
 * @returns {object} Book info and sections
 */
export async function getTableOfContents(bookId, options = {}) {
  const { tocPath = DEFAULT_TOC_PATH } = options;

  let index;
  try {
    const content = await readFile(tocPath, 'utf-8');
    index = JSON.parse(content);
  } catch (error) {
    throw new Error(`TOC index not found at ${tocPath}. Run: node src/toc.js build`);
  }

  const bid = bookId.toLowerCase();
  const book = index.books[bid];

  if (!book) {
    const available = Object.keys(index.books).join(', ');
    throw new Error(`Book not found: ${bookId}. Available: ${available}`);
  }

  const sections = index.sections
    .filter(s => s.bookId === bid)
    .map(s => ({
      name: s.name,
      page: s.page,
      depth: s.depth,
      path: s.path,
      contentSize: s.contentSize,
    }));

  return {
    id: book.id,
    name: book.name,
    published: book.published,
    sectionCount: book.sectionCount,
    sections,
  };
}

/**
 * Find sections by name across all books
 * @param {string} query - Search query for section names
 * @param {object} options - Options
 * @param {string} [options.book] - Filter to specific book
 * @param {string} [options.tocPath] - Path to TOC index
 * @returns {Array} Matching sections
 */
export async function findSections(query, options = {}) {
  const { book, tocPath = DEFAULT_TOC_PATH } = options;

  let index;
  try {
    const content = await readFile(tocPath, 'utf-8');
    index = JSON.parse(content);
  } catch (error) {
    throw new Error(`TOC index not found at ${tocPath}. Run: node src/toc.js build`);
  }

  const queryLower = query.toLowerCase();
  let sections = index.sections;

  if (book) {
    sections = sections.filter(s => s.bookId === book.toLowerCase());
  }

  return sections
    .filter(s =>
      s.name.toLowerCase().includes(queryLower) ||
      s.path.some(p => p.toLowerCase().includes(queryLower))
    )
    .map(s => ({
      bookId: s.bookId,
      bookName: index.books[s.bookId]?.name || s.bookId,
      name: s.name,
      page: s.page,
      depth: s.depth,
      path: s.path,
    }));
}
