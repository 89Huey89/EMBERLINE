import { CARGO } from "../data";
import type { CargoKind } from "../types";

const TAU = Math.PI * 2;

export type CargoUnitState = {
  /** Uniform scale applied before drawing. */
  size: number;
  /** 0..1 physical condition; below 0.72 counts as damaged. */
  condition: number;
  /** Game clock in seconds, for blinking lights. */
  time: number;
};

/**
 * Draws one cargo unit centred on the origin in a 30 x 22 box (before `size`).
 * The long axis runs along +x so units lie lengthwise on a ship's spine.
 */
export function drawCargoUnit(ctx: CanvasRenderingContext2D, kind: CargoKind, state: CargoUnitState) {
  const { size, condition } = state;
  const cargo = CARGO[kind];
  ctx.save();
  ctx.scale(size, size);
  if (cargo.shape === "tank") {
    ctx.fillStyle = "#20292a";
    ctx.fillRect(-14, -10, 28, 20);
    ctx.fillStyle = cargo.color;
    ctx.beginPath();
    ctx.roundRect(-11, -13, 22, 26, 9);
    ctx.fill();
    ctx.strokeStyle = cargo.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#14191a";
    ctx.fillRect(-13, -7, 26, 3);
    ctx.fillRect(-13, 5, 26, 3);
    ctx.fillStyle = cargo.accent;
    ctx.fillRect(-3, -17, 6, 4);
  } else if (cargo.shape === "ore") {
    ctx.fillStyle = "#292725";
    ctx.fillRect(-15, -11, 30, 22);
    ctx.strokeStyle = cargo.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(-15, -11, 30, 22);
    ctx.fillStyle = cargo.color;
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath();
      ctx.arc(-10 + (i * 13) % 23, -5 + (i * 9) % 12, 4 + (i % 3), 0, TAU);
      ctx.fill();
    }
  } else if (cargo.shape === "machine") {
    ctx.fillStyle = cargo.color;
    ctx.fillRect(-18, -9, 31, 18);
    ctx.fillStyle = "#22201c";
    ctx.beginPath();
    ctx.arc(10, 0, 9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = cargo.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(10, 0, 5, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = cargo.accent;
    ctx.fillRect(-20, -13, 7, 26);
  } else {
    ctx.fillStyle = cargo.color;
    ctx.fillRect(-15, -11, 30, 22);
    ctx.strokeStyle = cargo.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(-15, -11, 30, 22);
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.beginPath();
    ctx.moveTo(-15, -11); ctx.lineTo(15, 11);
    ctx.moveTo(15, -11); ctx.lineTo(-15, 11);
    ctx.stroke();
  }
  ctx.fillStyle = condition < 0.72 ? "#e9613d" : "#f0e3c3";
  ctx.font = "700 6px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(cargo.short, 0, 2);
  ctx.restore();
}
