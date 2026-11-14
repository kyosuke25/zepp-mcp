import { mkdir, writeFile } from 'node:fs/promises';
import fixture from '../test/fixtures/workout.json';
import { decodeWorkout } from '../src/decoder';
const decoded = decodeWorkout(fixture);
await mkdir('output', { recursive: true });
await writeFile('output/fixture-decoded.json', JSON.stringify(decoded, null, 2) + '\n');
console.log(JSON.stringify({ fixture: 'synthetic', sample_counts: decoded.sample_counts, timeline_count: decoded.timeline.length }));
