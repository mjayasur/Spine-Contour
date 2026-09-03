// CLI over cdp-lib.mjs.
//   node cdp.mjs '<js expression>'      evaluate in the page (awaits promises, prints JSON)
//   node cdp.mjs --file path.js         evaluate the file's text as one expression
//   node cdp.mjs --screenshot out.png   capture the page
//   node cdp.mjs --quit                 close the whole app cleanly (Browser.close)
// CDP_PORT=9222 by default. Relative module specifiers in expressions resolve against the
// file:// document, and module instances are shared with the running page.
import fs from 'node:fs';
import { connect, quitApp } from './cdp-lib.mjs';

const [mode, arg] = process.argv.slice(2);
if (!mode) {
  console.error('usage: node cdp.mjs <expression> | --file <path> | --screenshot <png> | --quit');
  process.exit(2);
}

if (mode === '--quit') {
  await quitApp();
  console.log('quit requested');
  process.exit(0);
}

const session = await connect();
try {
  if (mode === '--screenshot') {
    console.log('wrote', await session.screenshot(arg));
  } else {
    const expression = mode === '--file' ? fs.readFileSync(arg, 'utf8') : mode;
    console.log(JSON.stringify(await session.evaluate(expression), null, 2));
  }
  if (session.errors.length) console.error('page errors during call:', session.errors);
} finally {
  session.close();
}
