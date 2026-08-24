This folder contains raw files.

When ingested, a .md version should be added and the initial doc should be titled something sensible in the format <date of creation>_<title>.raw.<file extension>. The markdown file should be <date of creation>_<title>.md.

When reading, you should ALWAYS read the .md variant, not the raw file. This is to save significantly on token use.

For YouTube sources, use yt-ingest.sh in this folder. It needs only `uv` on PATH and pulls
metadata, descriptions, auto-caption transcripts and comments. Ingest its output the same way
as any other raw file: a .raw.json bundle plus a distilled .md that is the version you read.
