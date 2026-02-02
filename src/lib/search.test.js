import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { accessSync } from 'fs';

import {
  searchLibrary,
  getSection,
  listBooks,
  getTableOfContents,
  findSections,
} from './search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'library', 'search.db');
const TOC_PATH = join(__dirname, '..', '..', 'library', 'toc-index.json');

// Check if test data exists synchronously so skipIf works
function hasTestData() {
  try {
    accessSync(DB_PATH);
    accessSync(TOC_PATH);
    return true;
  } catch {
    return false;
  }
}

const skipIfNoData = !hasTestData();

describe('searchLibrary', () => {
  it.skipIf(skipIfNoData)('should find results for common D&D terms', () => {
    const results = searchLibrary('fireball', { limit: 5 });

    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('bookId');
    expect(results[0]).toHaveProperty('sectionPath');
    expect(results[0]).toHaveProperty('snippet');
  });

  it.skipIf(skipIfNoData)('should filter by book', () => {
    const results = searchLibrary('spell', { book: 'xphb', limit: 5 });

    expect(results.every(r => r.bookId === 'xphb')).toBe(true);
  });

  it.skipIf(skipIfNoData)('should respect limit parameter', () => {
    const results = searchLibrary('damage', { limit: 3 });

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it.skipIf(skipIfNoData)('should return empty array for no matches', () => {
    const results = searchLibrary('xyznonexistentterm123');

    expect(results).toEqual([]);
  });

  it.skipIf(skipIfNoData)('should handle multi-word queries', () => {
    const results = searchLibrary('saving throw', { limit: 5 });

    expect(results.length).toBeGreaterThan(0);
  });

  it('should throw error if database not found', () => {
    expect(() => searchLibrary('test', { dbPath: '/nonexistent/path.db' }))
      .toThrow('Search index not found');
  });
});

describe('getSection', () => {
  it.skipIf(skipIfNoData)('should retrieve section by exact name', () => {
    const section = getSection('xphb', 'Grappling');

    if (section) {
      expect(section.bookId).toBe('xphb');
      expect(section.content).toBeDefined();
      expect(section.content.length).toBeGreaterThan(0);
    }
  });

  it.skipIf(skipIfNoData)('should retrieve section by partial name', () => {
    const section = getSection('xphb', 'Combat');

    expect(section).not.toBeNull();
    expect(section.sectionName.toLowerCase()).toContain('combat');
  });

  it.skipIf(skipIfNoData)('should return null for nonexistent section', () => {
    const section = getSection('xphb', 'NonexistentSection12345');

    expect(section).toBeNull();
  });

  it('should throw error if database not found', () => {
    expect(() => getSection('xphb', 'test', { dbPath: '/nonexistent/path.db' }))
      .toThrow('Search index not found');
  });
});

describe('listBooks', () => {
  it.skipIf(skipIfNoData)('should return list of all books', () => {
    const books = listBooks();

    expect(Array.isArray(books)).toBe(true);
    expect(books.length).toBeGreaterThan(0);
    expect(books[0]).toHaveProperty('id');
    expect(books[0]).toHaveProperty('name');
    expect(books[0]).toHaveProperty('sections');
    expect(books[0]).toHaveProperty('sizeBytes');
  });

  it.skipIf(skipIfNoData)('should include expected books', () => {
    const books = listBooks();
    const bookIds = books.map(b => b.id);

    // Check for some expected books
    expect(bookIds).toContain('xphb');
    expect(bookIds).toContain('xdmg');
  });
});

describe('getTableOfContents', () => {
  it.skipIf(skipIfNoData)('should return TOC for valid book', async () => {
    const toc = await getTableOfContents('xphb');

    expect(toc).toHaveProperty('id');
    expect(toc).toHaveProperty('name');
    expect(toc).toHaveProperty('sections');
    expect(Array.isArray(toc.sections)).toBe(true);
    expect(toc.sections.length).toBeGreaterThan(0);
  });

  it.skipIf(skipIfNoData)('should include section details', async () => {
    const toc = await getTableOfContents('xphb');
    const section = toc.sections[0];

    expect(section).toHaveProperty('name');
    expect(section).toHaveProperty('depth');
    expect(section).toHaveProperty('path');
  });

  it.skipIf(skipIfNoData)('should throw error for invalid book', async () => {
    await expect(getTableOfContents('nonexistentbook'))
      .rejects.toThrow('Book not found');
  });

  it('should throw error if TOC index not found', async () => {
    await expect(getTableOfContents('xphb', { tocPath: '/nonexistent/toc.json' }))
      .rejects.toThrow('TOC index not found');
  });
});

describe('findSections', () => {
  it.skipIf(skipIfNoData)('should find sections by name', async () => {
    const sections = await findSections('grappling');

    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0]).toHaveProperty('bookId');
    expect(sections[0]).toHaveProperty('name');
    expect(sections[0]).toHaveProperty('path');
  });

  it.skipIf(skipIfNoData)('should filter by book', async () => {
    const sections = await findSections('combat', { book: 'xphb' });

    expect(sections.every(s => s.bookId === 'xphb')).toBe(true);
  });

  it.skipIf(skipIfNoData)('should return empty array for no matches', async () => {
    const sections = await findSections('xyznonexistentterm123');

    expect(sections).toEqual([]);
  });
});

describe('search result formatting', () => {
  it.skipIf(skipIfNoData)('should include highlight markers in snippets', () => {
    const results = searchLibrary('fireball', { limit: 1 });

    if (results.length > 0) {
      // Snippets should have >>> and <<< markers for highlighting
      expect(results[0].snippet).toMatch(/>>>|<<</);
    }
  });

  it.skipIf(skipIfNoData)('should include page numbers when available', () => {
    const results = searchLibrary('chapter', { book: 'xphb', limit: 10 });

    // At least some results should have page numbers
    const withPages = results.filter(r => r.page !== null);
    expect(withPages.length).toBeGreaterThan(0);
  });
});
