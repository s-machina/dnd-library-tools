#!/usr/bin/env node

/**
 * List available books from a 5etools sparse clone
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

async function main() {
  const dataPath = process.argv[2] || process.env.FIVETOOLS_DATA || './5etools-data';
  const booksJsonPath = join(dataPath, 'data', 'books.json');

  try {
    const content = await readFile(booksJsonPath, 'utf-8');
    const { book: books } = JSON.parse(content);

    console.log('Available Books:\n');
    console.log('ID'.padEnd(12) + 'Name');
    console.log('-'.repeat(60));

    for (const book of books) {
      const id = book.id.toLowerCase();
      console.log(`${id.padEnd(12)}${book.name}`);
    }

    console.log(`\nTotal: ${books.length} books`);
    console.log(`\nData path: ${dataPath}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Error: Could not find books.json at ${booksJsonPath}`);
      console.error('\nMake sure you have cloned the 5etools data:');
      console.error('  git clone --filter=blob:none --sparse https://github.com/5etools-mirror-3/5etools-src.git 5etools-data');
      console.error('  cd 5etools-data');
      console.error('  git sparse-checkout set data/book data/books.json');
      console.error('\nOr set FIVETOOLS_DATA environment variable to point to your clone.');
    } else {
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
