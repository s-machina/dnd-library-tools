#!/usr/bin/env node

/**
 * MCP Server for D&D Library Tools
 *
 * Exposes search and lookup tools via Model Context Protocol
 * for AI integration (Claude, etc.)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  searchLibrary,
  getSection,
  listBooks,
  getTableOfContents,
  findSections,
} from './lib/search.js';

const server = new Server(
  {
    name: 'dnd-library',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const TOOLS = [
  {
    name: 'search_rules',
    description: 'Search D&D rulebooks for content matching a query. Returns relevant sections with snippets. Use this to find rules, spell descriptions, monster stats, or any other content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "grappling rules", "fireball damage", "stealth check")',
        },
        book: {
          type: 'string',
          description: 'Optional book ID to search within (e.g., "xphb" for Player\'s Handbook 2024, "xdmg" for DMG 2024)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_section',
    description: 'Get the full content of a specific section from a book. Use this when you know the book and section name.',
    inputSchema: {
      type: 'object',
      properties: {
        book: {
          type: 'string',
          description: 'Book ID (e.g., "xphb", "xdmg", "xmm", "erlw")',
        },
        section: {
          type: 'string',
          description: 'Section name or path (e.g., "Grappling", "Chapter 1", "Combat")',
        },
      },
      required: ['book', 'section'],
    },
  },
  {
    name: 'list_books',
    description: 'List all available D&D books in the library with their IDs and section counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_toc',
    description: 'Get the table of contents for a specific book, showing all chapters and sections.',
    inputSchema: {
      type: 'object',
      properties: {
        book: {
          type: 'string',
          description: 'Book ID (e.g., "xphb", "xdmg")',
        },
      },
      required: ['book'],
    },
  },
  {
    name: 'find_sections',
    description: 'Find sections by name across all books. Use this to locate where a topic is covered.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Section name to search for (e.g., "Combat", "Spellcasting", "Warforged")',
        },
        book: {
          type: 'string',
          description: 'Optional book ID to search within',
        },
      },
      required: ['query'],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_rules': {
        const results = searchLibrary(args.query, {
          book: args.book,
          limit: args.limit || 10,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No results found for "${args.query}"`,
              },
            ],
          };
        }

        const formatted = results.map(r => {
          const page = r.page ? ` (p.${r.page})` : '';
          return `**[${r.bookId}] ${r.sectionPath}${page}**\n${r.snippet.replace(/>>>/g, '**').replace(/<<</g, '**')}`;
        }).join('\n\n---\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${results.length} results for "${args.query}":\n\n${formatted}`,
            },
          ],
        };
      }

      case 'lookup_section': {
        const section = getSection(args.book, args.section);

        if (!section) {
          return {
            content: [
              {
                type: 'text',
                text: `Section not found: "${args.section}" in book "${args.book}"`,
              },
            ],
          };
        }

        const page = section.page ? ` (Page ${section.page})` : '';
        return {
          content: [
            {
              type: 'text',
              text: `# ${section.sectionName}${page}\n**Book:** ${section.bookName}\n**Path:** ${section.sectionPath}\n\n---\n\n${section.content}`,
            },
          ],
        };
      }

      case 'list_books': {
        const books = listBooks();

        const formatted = books.map(b => {
          const sizeKb = Math.round(b.sizeBytes / 1024);
          return `- **${b.id}**: ${b.name} (${b.sections} sections, ${sizeKb}KB)`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `# Available Books\n\n${formatted}\n\nTotal: ${books.length} books`,
            },
          ],
        };
      }

      case 'get_toc': {
        const toc = await getTableOfContents(args.book);

        const formatted = toc.sections.map(s => {
          const indent = '  '.repeat(s.depth);
          const page = s.page ? ` (p.${s.page})` : '';
          return `${indent}- ${s.name}${page}`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `# ${toc.name}\n\n${formatted}\n\nTotal sections: ${toc.sectionCount}`,
            },
          ],
        };
      }

      case 'find_sections': {
        const sections = await findSections(args.query, { book: args.book });

        if (sections.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No sections found matching "${args.query}"`,
              },
            ],
          };
        }

        const formatted = sections.map(s => {
          const page = s.page ? ` (p.${s.page})` : '';
          return `- **[${s.bookId}]** ${s.path.join(' > ')}${page}`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${sections.length} sections matching "${args.query}":\n\n${formatted}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('D&D Library MCP Server running on stdio');
}

main().catch(console.error);
