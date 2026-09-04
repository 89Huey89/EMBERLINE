import type { Metadata } from "next";
import EmberlineGame from "./game/EmberlineGame";

export const metadata: Metadata = {
  title: "EMBERLINE — Civilian Orbital Freight",
  description: "Fly, haul, salvage, and build a working life among the close orbits of the Cinder system.",
};

export default function Home() {
  return <EmberlineGame />;
}
