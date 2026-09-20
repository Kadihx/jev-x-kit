/**
 * Data-center storage — node:sqlite with FTS5 full-text search.
 *
 * Schema:
 *   documents(id, source, url UNIQUE, title, content, content_hash, word_count,
 *             crawled_at, ...license metadata, quality flags)
 *   documents_fts  (FTS5 over title + content, tokenize=unicode61)
 *   crawl_runs(id, started_at, finished_at, sources_json, stats_json)
 *
 * node:sqlite is built into Node >= 22. No native modules, no extra deps.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export interface StoredDocument {
  id: number;
  source: string;
  url: string;
  title: string;
  content: string;
  content_hash: string;
  word_count: number;
  crawled_at: string;
  license: string | null;
  author: string | null;
  published: string | null;
  quality_score: number | null;
  verified: number;
}

export interface CrawlStats {
  source: string;
  discovered: number;
  fetched: number;
  stored: number;
  skipped_unchanged: number;
  blocked_license: number;
  errors: number;
  ms: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  crawled_at TEXT NOT NULL,
  license TEXT,
  author TEXT,
  published TEXT,
  quality_score REAL,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title, content, content='documents', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE OF title, content ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content)
  VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO documents_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;
CREATE TABLE IF NOT EXISTS crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  sources_json TEXT NOT NULL,
  stats_json TEXT
);
`;

export function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "research-hub.sqlite");
}

export class HubStore {
  private db: DatabaseSync;

  constructor(dbPath: string = defaultDbPath()) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }


  /** Insert or refresh a document; unchanged content is skipped by hash. */
  upsert(doc: {
    source: string;
    url: string;
    title: string;
    content: string;
    content_hash: string;
    license?: string | null;
    author?: string | null;
    published?: string | null;
  }): "inserted" | "updated" | "unchanged" {
    const existing = this.db
      .prepare("SELECT id, content_hash FROM documents WHERE url = ?")
      .get(doc.url) as { id: number; content_hash: string } | undefined;

    const wordCount = doc.content.split(/\s+/).filter(Boolean).length;
    const now = new Date().toISOString();

    if (!existing) {
      this.db
        .prepare(
          "INSERT INTO documents (source, url, title, content, content_hash, word_count, crawled_at, license, author, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(doc.source, doc.url, doc.title, doc.content, doc.content_hash, wordCount, now, doc.license ?? null, doc.author ?? null, doc.published ?? null);
      return "inserted";
    }
    if (existing.content_hash === doc.content_hash) return "unchanged";
    this.db
      .prepare(
        "UPDATE documents SET title = ?, content = ?, content_hash = ?, word_count = ?, crawled_at = ?, license = COALESCE(?, license), author = COALESCE(?, author), published = COALESCE(?, published) WHERE id = ?",
      )
      .run(doc.title, doc.content, doc.content_hash, wordCount, now, doc.license ?? null, doc.author ?? null, doc.published ?? null, existing.id);
    return "updated";
  }

  /** FTS5 search with BM25 ranking. */
  search(query: string, limit = 20, source?: string): StoredDocument[] {
    const stripped = query.replace(/["*^:()-]/g, " ").trim();
    if (!stripped) return [];
    // Natural-language questions rarely contain every term in one document;
    // OR the terms and let the Jev relevance re-rank (query.ts) do the real
    // filtering instead of FTS5's implicit (too strict) AND-of-all-terms.
    const terms = stripped.split(/\s+/).filter((t) => t.length > 1);
    const safe = terms.length > 1 ? terms.join(" OR ") : stripped;
    if (!safe) return [];
    const base =
      "SELECT d.* FROM documents d JOIN documents_fts f ON d.id = f.rowid WHERE documents_fts MATCH ?";
    if (source) {
      return this.db.prepare(`${base} AND d.source = ? ORDER BY rank LIMIT ?`).all(safe, source, limit) as unknown as StoredDocument[];
    }
    return this.db.prepare(`${base} ORDER BY rank LIMIT ?`).all(safe, limit) as unknown as StoredDocument[];
  }

  listRecent(limit = 20, source?: string): StoredDocument[] {
    if (source) {
      return this.db.prepare("SELECT * FROM documents WHERE source = ? ORDER BY crawled_at DESC LIMIT ?").all(source, limit) as unknown as StoredDocument[];
    }
    return this.db.prepare("SELECT * FROM documents ORDER BY crawled_at DESC LIMIT ?").all(limit) as unknown as StoredDocument[];
  }

  markQuality(url: string, score: number, verified: boolean): void {
    this.db.prepare("UPDATE documents SET quality_score = ?, verified = ? WHERE url = ?").run(score, verified ? 1 : 0, url);
  }

  stats(): { sources: Array<{ source: string; docs: number; words: number }>; total: number } {
    const rows = this.db
      .prepare("SELECT source, COUNT(*) as docs, COALESCE(SUM(word_count), 0) as words FROM documents GROUP BY source ORDER BY docs DESC")
      .all() as Array<{ source: string; docs: number; words: number }>;
    return { sources: rows, total: rows.reduce((a, r) => a + r.docs, 0) };
  }

  beginRun(sources: string[]): number {
    const row = this.db
      .prepare("INSERT INTO crawl_runs (started_at, sources_json) VALUES (?, ?) RETURNING id")
      .get(new Date().toISOString(), JSON.stringify(sources)) as { id: number };
    return row.id;
  }

  finishRun(id: number, stats: CrawlStats[]): void {
    this.db.prepare("UPDATE crawl_runs SET finished_at = ?, stats_json = ? WHERE id = ?").run(new Date().toISOString(), JSON.stringify(stats), id);
  }

  runs(limit = 10): Array<{ id: number; started_at: string; finished_at: string | null; stats_json: string | null }> {
    return this.db.prepare("SELECT id, started_at, finished_at, stats_json FROM crawl_runs ORDER BY id DESC LIMIT ?").all(limit) as Array<{
      id: number;
      started_at: string;
      finished_at: string | null;
      stats_json: string | null;
    }>;
  }
}
