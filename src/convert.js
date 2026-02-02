#!/usr/bin/env node

/**
 * Convert 5etools JSON book format to clean markdown
 *
 * Usage: node convert.js <5etools-data-path> [book-ids...]
 * Example: node convert.js ./5etools-data xphb erlw egw
 */

import { readFile, writeFile, readdir, access, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Convert 5etools tag format to plain text or markdown
function convertTags(text) {
  if (typeof text !== 'string') return text;

  // {@book Title|ABBR} -> "Title"
  text = text.replace(/\{@book ([^|]+)\|[^}]+\}/g, '"$1"');

  // {@race Name|Source|...} -> Name
  text = text.replace(/\{@race ([^|]+)(?:\|[^}]*)?\}/g, '$1');

  // {@class Name|Source|...} -> Name
  text = text.replace(/\{@class ([^|]+)(?:\|[^}]*)?\}/g, '$1');

  // {@feat Name|Source} -> Name
  text = text.replace(/\{@feat ([^|]+)(?:\|[^}]*)?\}/g, '$1');

  // {@spell Name|Source} -> *Name*
  text = text.replace(/\{@spell ([^|]+)(?:\|[^}]*)?\}/g, '*$1*');

  // {@item Name|Source} -> Name
  text = text.replace(/\{@item ([^|]+)(?:\|[^}]*)?\}/g, '$1');

  // {@creature Name|Source} -> Name
  text = text.replace(/\{@creature ([^|]+)(?:\|[^}]*)?\}/g, '$1');

  // {@b text} -> **text**
  text = text.replace(/\{@b ([^}]+)\}/g, '**$1**');

  // {@i text} -> *text*
  text = text.replace(/\{@i ([^}]+)\}/g, '*$1*');

  // {@bold text} -> **text**
  text = text.replace(/\{@bold ([^}]+)\}/g, '**$1**');

  // {@italic text} -> *text*
  text = text.replace(/\{@italic ([^}]+)\}/g, '*$1*');

  // {@dice expression} -> expression
  text = text.replace(/\{@dice ([^}]+)\}/g, '$1');

  // {@damage expression} -> expression
  text = text.replace(/\{@damage ([^}]+)\}/g, '$1');

  // {@hit +N} -> +N
  text = text.replace(/\{@hit ([^}]+)\}/g, '$1');

  // {@dc N} -> DC N
  text = text.replace(/\{@dc ([^}]+)\}/g, 'DC $1');

  // {@skill Name} -> Name
  text = text.replace(/\{@skill ([^}]+)\}/g, '$1');

  // {@condition Name} -> Name
  text = text.replace(/\{@condition ([^}]+)\}/g, '$1');

  // {@sense Name} -> Name
  text = text.replace(/\{@sense ([^}]+)\}/g, '$1');

  // {@action Name} -> Name
  text = text.replace(/\{@action ([^}]+)\}/g, '$1');

  // {@note text} -> *(text)*
  text = text.replace(/\{@note ([^}]+)\}/g, '*($1)*');

  // Generic fallback for any remaining {@tag content|...}
  text = text.replace(/\{@\w+ ([^|}]+)(?:\|[^}]*)?\}/g, '$1');

  return text;
}

function convertEntry(entry, depth = 0) {
  if (typeof entry === 'string') {
    return convertTags(entry);
  }

  if (Array.isArray(entry)) {
    return entry.map(e => convertEntry(e, depth)).join('\n\n');
  }

  if (typeof entry !== 'object' || entry === null) {
    return '';
  }

  const lines = [];
  const headingLevel = '#'.repeat(Math.min(depth + 2, 6));

  switch (entry.type) {
    case 'section':
    case 'entries':
      if (entry.name) {
        lines.push(`${headingLevel} ${convertTags(entry.name)}`);
        if (entry.page) {
          lines.push(`*Page ${entry.page}*`);
        }
        lines.push('');
      }
      if (entry.entries) {
        lines.push(convertEntry(entry.entries, depth + 1));
      }
      break;

    case 'table':
      if (entry.caption) {
        lines.push(`**${convertTags(entry.caption)}**`);
        lines.push('');
      }
      if (entry.colLabels && entry.colLabels.length > 0) {
        lines.push('| ' + entry.colLabels.map(convertTags).join(' | ') + ' |');
        lines.push('| ' + entry.colLabels.map(() => '---').join(' | ') + ' |');
      }
      if (entry.rows) {
        for (const row of entry.rows) {
          const cells = row.map(cell => {
            if (typeof cell === 'string') return convertTags(cell);
            if (cell && cell.entry) return convertTags(cell.entry);
            if (cell && cell.entries) return cell.entries.map(e => convertTags(e)).join('; ');
            return String(cell);
          });
          lines.push('| ' + cells.join(' | ') + ' |');
        }
      }
      lines.push('');
      break;

    case 'list':
      if (entry.items) {
        for (const item of entry.items) {
          if (typeof item === 'string') {
            lines.push(`- ${convertTags(item)}`);
          } else if (item.name && item.entry) {
            lines.push(`- **${convertTags(item.name)}**: ${convertTags(item.entry)}`);
          } else if (item.name && item.entries) {
            lines.push(`- **${convertTags(item.name)}**: ${convertEntry(item.entries, depth)}`);
          } else if (item.entries) {
            lines.push(`- ${convertEntry(item.entries, depth)}`);
          }
        }
      }
      lines.push('');
      break;

    case 'quote':
      if (entry.entries) {
        for (const e of entry.entries) {
          lines.push(`> ${convertTags(e)}`);
        }
      }
      if (entry.from) {
        lines.push(`> — ${convertTags(entry.from)}`);
      }
      lines.push('');
      break;

    case 'insetReadaloud':
    case 'inset':
      lines.push('---');
      if (entry.name) {
        lines.push(`**${convertTags(entry.name)}**`);
        lines.push('');
      }
      if (entry.entries) {
        lines.push(convertEntry(entry.entries, depth));
      }
      lines.push('---');
      lines.push('');
      break;

    case 'image':
      if (entry.href && entry.href.path) {
        const altText = entry.title || 'Image';
        lines.push(`![${altText}](${entry.href.path})`);
      }
      lines.push('');
      break;

    case 'statblock':
    case 'statblockInline':
      if (entry.name) {
        lines.push(`**[Statblock: ${entry.name}]**`);
      }
      break;

    default:
      if (entry.name) {
        lines.push(`${headingLevel} ${convertTags(entry.name)}`);
        lines.push('');
      }
      if (entry.entries) {
        lines.push(convertEntry(entry.entries, depth + 1));
      }
      if (entry.entry) {
        lines.push(convertEntry(entry.entry, depth));
      }
      break;
  }

  return lines.join('\n');
}

async function convertBook(bookPath, outputPath, bookName) {
  console.log(`Converting: ${bookName}`);

  const content = await readFile(bookPath, 'utf-8');
  const book = JSON.parse(content);

  const lines = [];

  lines.push(`# ${bookName}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (book.data && Array.isArray(book.data)) {
    for (const section of book.data) {
      lines.push(convertEntry(section, 0));
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  const markdown = lines.join('\n');
  await writeFile(outputPath, markdown);
  console.log(`  Saved: ${outputPath}`);
}

async function ensureDir(dir) {
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node convert.js <5etools-data-path> [book-ids...]');
    console.log('Example: node convert.js ./5etools-data xphb erlw egw');
    console.log('\nIf no book IDs specified, converts all books.');
    process.exit(1);
  }

  const dataPath = args[0];
  const requestedBooks = args.slice(1).map(b => b.toLowerCase());

  const booksDir = join(dataPath, 'data', 'book');
  const booksJsonPath = join(dataPath, 'data', 'books.json');
  const outputDir = join(dirname(dataPath), 'markdown');

  // Load book metadata
  let booksMeta;
  try {
    const content = await readFile(booksJsonPath, 'utf-8');
    booksMeta = JSON.parse(content).book;
  } catch (error) {
    console.error(`Error reading books.json: ${error.message}`);
    process.exit(1);
  }

  // Build lookup
  const bookLookup = {};
  for (const book of booksMeta) {
    bookLookup[book.id.toLowerCase()] = book.name;
  }

  // Get list of book files
  let bookFiles;
  try {
    bookFiles = await readdir(booksDir);
  } catch (error) {
    console.error(`Error reading books directory: ${error.message}`);
    process.exit(1);
  }

  // Filter to requested books
  let booksToConvert = bookFiles.filter(f => f.endsWith('.json'));
  if (requestedBooks.length > 0) {
    booksToConvert = booksToConvert.filter(f => {
      const id = f.replace('book-', '').replace('.json', '');
      return requestedBooks.includes(id);
    });
  }

  await ensureDir(outputDir);

  console.log('=== Converting to Markdown ===\n');

  for (const file of booksToConvert) {
    const bookId = file.replace('book-', '').replace('.json', '');
    const bookName = bookLookup[bookId] || bookId.toUpperCase();
    const bookPath = join(booksDir, file);
    const outputPath = join(outputDir, `${bookId}.md`);

    try {
      await convertBook(bookPath, outputPath, bookName);
    } catch (error) {
      console.error(`  Error: ${error.message}`);
    }
  }

  console.log(`\nOutput directory: ${outputDir}`);
}

main().catch(console.error);
