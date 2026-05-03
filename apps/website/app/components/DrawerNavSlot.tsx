"use client";

import { NavBar } from "./NavBar";
import { useDrawer } from "./useDrawer";

export function DrawerNavSlot() {
  const { close } = useDrawer();
  return <NavBar mode="drawer" onClose={close} />;
}
