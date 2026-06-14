/// <reference lib="webworker" />
import { Graph } from "@/lib/geo/graph";
import { SimEngine } from "@/lib/sim/engine";
import { SIM } from "@/lib/config";
import type { FromWorker, ToWorker } from "@/lib/types";

let engine: SimEngine | null = null;
let agentCount = 0;
let playing = false;
let speed = 60;
let timer: ReturnType<typeof setInterval> | null = null;

const post = (msg: FromWorker, transfer?: Transferable[]) => {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
};

function snapshot(): void {
  if (!engine) return;
  const positions = new Float32Array(agentCount * 2);
  const states = new Uint8Array(agentCount);
  const meta = engine.writeSnapshot(positions, states);
  post({ type: "snapshot", positions: positions.buffer, states: states.buffer, meta }, [
    positions.buffer,
    states.buffer,
  ]);
}

function tick(): void {
  if (!engine || !playing) return;
  const dtReal = 1 / SIM.tickHz;
  engine.step(dtReal * speed);
  snapshot();
}

function startTimer(): void {
  if (timer != null) return;
  timer = setInterval(tick, 1000 / SIM.tickHz);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      const graph = new Graph(msg.graph);
      agentCount = msg.agentCount;
      engine = new SimEngine(
        graph,
        msg.zones,
        msg.pois,
        msg.agentCount,
        msg.startBudget,
        msg.bankruptcy,
        { costMult: msg.costMult, opexMult: msg.opexMult, fareMult: msg.fareMult, capMult: msg.capMult },
      );
      post({ type: "ready" });
      snapshot();
      startTimer();
      break;
    }
    case "play":
      playing = true;
      break;
    case "pause":
      playing = false;
      snapshot();
      break;
    case "speed":
      speed = msg.value;
      break;
    case "setNetwork":
      engine?.setNetwork(msg.lines);
      snapshot();
      break;
  }
};
