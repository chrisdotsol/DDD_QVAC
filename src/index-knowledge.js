import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chunkMarkdown } from './retrieval.js';
import { paths } from './paths.js';

async function main() {
  const files = (await readdir(paths.knowledgeDir)).filter((file) => file.endsWith('.md')).sort();
  const chunks = [];

  for (const file of files) {
    const markdown = await readFile(join(paths.knowledgeDir, file), 'utf8');
    chunks.push(...chunkMarkdown({ sourceFile: file, markdown }));
  }

  const index = {
    generated_at: new Date().toISOString(),
    retrieval_mode: 'local_keyword',
    embedding_model: null,
    chunk_count: chunks.length,
    chunks
  };

  await mkdir(dirname(paths.knowledgeIndex), { recursive: true });
  await writeFile(paths.knowledgeIndex, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${paths.knowledgeIndex}`);
  console.log(`Chunks indexed: ${chunks.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
