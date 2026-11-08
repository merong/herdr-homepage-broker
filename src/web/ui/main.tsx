import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TerminalThumb } from "./TerminalThumb";
import { StageBar } from "./StageBar";
import { ListThumb, ShotCover, ShotStrip } from "./Shots";
import { DetailSections, RunSummary } from "./Detail";
import { Structure } from "./Structure";
import { Landing } from "./Landing";
import { Concept } from "./Concept";
import { Questions } from "./Questions";

const components: Record<string, ComponentType<any>> = {
  TerminalThumb,
  StageBar,
  RunSummary,
  DetailSections,
  ShotStrip,
  ShotCover,
  ListThumb,
  Structure,
  Landing,
  Concept,
  Questions,
};

// The plain-JS shell rebuilds its DOM on every snapshot. Each React part lives
// in a container kept here by key: the shell re-inserts the same element, so
// the root (and component state, fetched pages) survives. Dialogs render into
// <body> through portals because re-insertion would drop a modal's top layer.
// begin()/end() bracket one shell render; roots not used in it are unmounted.
// `keep` slots live in static markup (the request dialog) outside that render
// and stay mounted.
interface Slot {
  el: HTMLElement;
  root: Root;
  name: string;
  used: boolean;
  keep: boolean;
}
const slots = new Map<string, Slot>();

function slot(
  key: string,
  name: string,
  props: object,
  cls = "",
  keep = false,
) {
  const component = components[name];
  if (!component) throw new Error(`Unknown component ${name}`);
  let s = slots.get(key);
  if (!s || s.name !== name) {
    s?.root.unmount();
    const el = document.createElement("div");
    s = { el, root: createRoot(el), name, used: true, keep };
    slots.set(key, s);
  }
  s.el.className = cls;
  s.used = true;
  s.root.render(createElement(component, props));
  return s.el;
}
function begin() {
  for (const s of slots.values()) s.used = false;
}
function end() {
  for (const [key, s] of slots)
    if (!s.used && !s.keep) {
      s.root.unmount();
      slots.delete(key);
    }
}

declare global {
  interface Window {
    BrokerUI: { slot: typeof slot; begin: typeof begin; end: typeof end };
  }
}
window.BrokerUI = { slot, begin, end };

// The landing page (`/`) has no plain-JS shell: it mounts itself here. The
// static fallback inside #landing stays only when this bundle fails to load.
const landing = document.getElementById("landing");
if (landing) {
  landing.replaceChildren();
  createRoot(landing).render(createElement(Landing));
}
