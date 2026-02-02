# D&D Library Tools

Tools to work with D&D sourcebooks from the [5etools mirror](https://github.com/5etools-mirror-3/5etools-src) as an AI reference library.

## Setup: Sparse Clone

Clone only the book data (not the full website):

```bash
cd /path/to/your/libraries
git clone --filter=blob:none --sparse https://github.com/5etools-mirror-3/5etools-src.git 5etools-data
cd 5etools-data
git sparse-checkout set data/book data/books.json
```

To update later:
```bash
git pull
```

## Structure

After cloning, you'll have:
```
5etools-data/
└── data/
    ├── books.json              # Index of all books
    └── book/
        ├── book-xphb.json      # Player's Handbook 2024
        ├── book-xdmg.json      # Dungeon Master's Guide 2024
        ├── book-xmm.json       # Monster Manual 2024
        ├── book-erlw.json      # Eberron: Rising from the Last War
        ├── book-efa.json       # Eberron: Forge of the Artificer
        ├── book-egw.json       # Explorer's Guide to Wildemount
        └── ...                 # 60+ books total
```

## Book Abbreviations

| ID | Name |
|----|------|
| `xphb` | Player's Handbook (2024) |
| `xdmg` | Dungeon Master's Guide (2024) |
| `xmm` | Monster Manual (2024) |
| `phb` | Player's Handbook (2014) |
| `dmg` | Dungeon Master's Guide (2014) |
| `mm` | Monster Manual (2014) |
| `erlw` | Eberron: Rising from the Last War |
| `efa` | Eberron: Forge of the Artificer |
| `egw` | Explorer's Guide to Wildemount |
| `xge` | Xanathar's Guide to Everything |
| `tce` | Tasha's Cauldron of Everything |

Run `node src/list.js` to see all available books.

## Tools

### List Books
```bash
node src/list.js
```

### Convert to Markdown (Optional)
```bash
node src/convert.js /path/to/5etools-data xphb erlw
```

## JSON Format

The JSON is already excellent for LLM consumption:

```json
{
  "data": [
    {
      "type": "section",
      "name": "Chapter Title",
      "page": 4,
      "entries": [
        "Plain text paragraph",
        {"type": "entries", "name": "Subsection", "entries": [...]}
      ]
    }
  ]
}
```

Tags like `{@spell Fireball}` reference other content and can be resolved or left as-is.
