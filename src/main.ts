import { run } from './action.js';

// Entry point for GitHub Action
// istanbul ignore next - Action entrypoint
if (require.main === module) {
  run().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
