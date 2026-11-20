import { Pane } from "tweakpane";

export function createControls(CONFIG, { onDamping, onSurface, onLook, onRespawn }) {
  const pane = new Pane({ title: "icon swarm", expanded: false });

  pane
    .addBinding(CONFIG, "count", { min: 5, max: 120, step: 1 })
    .on("change", (ev) => ev.last && onRespawn());
  pane.addButton({ title: "respawn" }).on("click", () => onRespawn());

  const pull = pane.addFolder({ title: "pull & push" });
  pull.addBinding(CONFIG, "attraction", { min: 0.5, max: 30 });
  pull.addBinding(CONFIG, "maxPull", { label: "max pull", min: 1, max: 60 });
  pull.addBinding(CONFIG, "repelRadius", { label: "repel radius", min: 0.25, max: 6 });
  pull.addBinding(CONFIG, "repelStrength", { label: "repel strength", min: 0, max: 600 });
  pull.addBinding(CONFIG, "repelSpin", { label: "repel spin", min: 0, max: 40 });

  const blast = pane.addFolder({ title: "click blast" });
  blast.addBinding(CONFIG, "blastRadius", { label: "radius", min: 0.5, max: 12 });
  blast.addBinding(CONFIG, "blastStrength", { label: "strength", min: 0, max: 60 });
  blast.addBinding(CONFIG, "blastSpin", { label: "spin", min: 0, max: 30 });

  const phys = pane.addFolder({ title: "physics", expanded: false });
  const damping = (b) => b.on("change", () => onDamping());
  const surface = (b) => b.on("change", () => onSurface());
  damping(phys.addBinding(CONFIG, "linearDamping", { label: "drag", min: 0, max: 5 }));
  damping(phys.addBinding(CONFIG, "angularDamping", { label: "spin drag", min: 0, max: 5 }));
  surface(phys.addBinding(CONFIG, "restitution", { label: "bounce", min: 0, max: 1 }));
  surface(phys.addBinding(CONFIG, "friction", { min: 0, max: 1.5 }));
  phys.addBinding(CONFIG, "spawnSpeed", { label: "spawn speed", min: 0, max: 30 });
  phys.addBinding(CONFIG, "spawnInterval", { label: "spawn gap", min: 0.01, max: 1 });

  const look = pane.addFolder({ title: "look", expanded: false });
  const live = (b) => b.on("change", () => onLook());
  live(look.addBinding(CONFIG.look, "background"));
  live(look.addBinding(CONFIG.look, "clearcoat", { min: 0, max: 1 }));
  live(look.addBinding(CONFIG.look, "shadow", { min: 0, max: 0.6 }));
  live(look.addBinding(CONFIG.look, "environment", { min: 0, max: 2 }));

  return pane;
}
