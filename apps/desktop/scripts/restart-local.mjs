import {
  readRestartJob,
  runRestartWorker,
  signalRestart,
  startLocalRestart,
} from "../src/local-restart-coordinator.ts";
const [action = "start", argument] = process.argv.slice(2);
if (action === "worker") await runRestartWorker(argument);
else if (action === "start")
  console.log(
    JSON.stringify(
      await startLocalRestart(undefined, argument === "--now"),
      null,
      2,
    ),
  );
else if (action === "status")
  console.log(JSON.stringify(await readRestartJob(), null, 2));
else if (action === "cancel" || action === "now")
  console.log(JSON.stringify(await signalRestart(action), null, 2));
else throw new Error("Use start, status, cancel, or now");
