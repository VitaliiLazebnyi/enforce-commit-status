/**
 * @file GitHub Action entrypoint (ECS-REQ-001). `run()` reports every failure itself through
 * `core.setFailed` and never rejects, so it is awaited unconditionally.
 */
import { run } from './action.ts';

await run();
