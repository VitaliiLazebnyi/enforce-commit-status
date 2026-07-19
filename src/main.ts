import { run } from './action.js';

// GitHub Action entrypoint (ECS-REQ-001). run() reports every failure itself
// via core.setFailed and never rejects, so it is invoked unconditionally.
void run();
