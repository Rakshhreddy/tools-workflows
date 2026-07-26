# How designers actually work with AI

A map of the tools ten designers at nine companies actually use, and how they move between them. Every claim is quoted from a full interview transcript and timestamped to the moment it was said.

No build step. Open `index.html` through any static server.

```bash
python3 -m http.server 8932
```

## What it shows

Tools are grouped into the phases every designer in the corpus moves through:

| Phase | Meaning |
|---|---|
| Gather | Signal in: inspiration, customer voice, what was said in the room |
| Frame | Turning raw signal into something you can act on |
| Explore | Going wide and rough, nothing precious |
| Build | Making it real in code, against the real design system |
| Ship | Out to engineers, stakeholders and production |

They are not numbered anywhere in the interface. Numbering would assert an order the sources do not claim: people enter wherever the work starts, and movement runs both ways. Left to right carries the flow on its own.

The axis is grounded in the sources, not invented. Danny Williams describes the explore to refine spine himself at 10:52, and Kazden Cattapan describes diverging then converging at 10:42.

Three levels of depth:

1. **Landscape.** Every tool, sized by how widely it is used, with dotted lines showing real handoffs.
2. **Company.** Selecting a company narrows to its flow. Companies with more than one designer reveal nested chips.
3. **Designer.** Narrows to one person. Hover overlays and the side panel scope to them.

## Design system

Four rules. If a change cannot be justified by one of them, it does not ship.

1. **Colour comes only from the brand marks.** Interface chrome is greyscale. The accent has exactly one job: showing what is selected.
2. **Logos sit on light tiles.** Brand marks are drawn for light surfaces, so a near white tile makes every one render as designed.
3. **Size is the only quantitative encoding.** No opacity ramps, no stroke width variation.
4. **One line style.** Dotted, arrowhead for direction.

Copy discipline: no legend explaining the encodings, no counts or rankings in the interface, and no em dashes anywhere. Labels carry the stage and the people, because this is one designer's workflow at one company, not a popularity contest.

The side panel invents no chrome of its own. It reuses the canvas vocabulary, so each kind of claim has a shape you can read at scroll speed: the header is a vertical slice of the graph, a quote carries no tile, a handoff leads with the other tool's mark, and a choice leads with both.

## Structure

```
index.html            markup shell
styles.css            tokens and layout
app.js                layout, rendering, interaction
data/landscape.json   the corpus
assets/logos/         brand marks, named by tool id
scripts/extract.py    YouTube transcript and chapter puller
```

## Data model

```
companies[] { id, name, type }
designers[] { id, companyId, name, role, thesis, source }
tools[]     { id, name, stage, axis, kind }
uses[]      { toolId, designerId, purpose, at }
moves[]     { from, to, designerId, reason, at }
choices[]   { designerId, a, b, criterion, at }
handoff[]   { designerId, claim, at }
```

`at` is seconds into the source video. Every rendered timestamp deep links to it.

Node size counts **distinct designers**, so two people at one company never double count a tool.

## Adding a logo

Drop a file into `assets/logos/` named exactly `<tool-id>.<ext>`, where the id is the key in `landscape.json`. Formats tried in order: svg, png, jpg, jpeg, webp. Anything missing falls back to a monogram, so assets can be added incrementally.

Full colour marks render as supplied. Monochrome SVGs using `currentColor` are tinted dark to sit on the light tile.

## Adding a source

```bash
pip3 install yt-dlp
python3 scripts/extract.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

This writes a cleaned, timestamped transcript plus the chapter list. Read the transcript in full before encoding anything. Chapters give tool and purpose, but never the handoffs between tools, which is the part that matters most here.

YouTube blocks plain caption fetches, so the puller uses the `android` player client.

## Corpus

Ten designers, nine companies. Descript has two.

| Designer | Role | Company |
|---|---|---|
| Danny Williams | Staff Product Designer | Wealthsimple |
| Kazden Cattapan | Product Designer | Shopify |
| Clint McManaman | Staff Product Designer | Givebutter |
| John Voss | Head of Design | Descript |
| Christina Kim | Senior Designer | Descript |
| Claire Taylor | Head of Design | Chronicle |
| Jennifer Spriggs | Staff Product Designer | CNN |
| Andy McClelland | Product Designer | ESO |
| Karl Koch | Design Engineer | DuckDuckGo |
| Henry Modisett | VP of Design | Perplexity |

All sources are [Sneak Peek](https://sneakpeek.design) interviews.

## A note on the sample

These are designers who chose to record a workflow walkthrough, which is not a random sample of the profession. So nothing is counted or ranked in the interface. Tile size is a soft weight and nothing more, and every claim on screen is attributed to the person who said it, at the moment they said it.
