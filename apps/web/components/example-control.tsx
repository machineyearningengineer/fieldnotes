"use client";
import { useState, type ReactNode } from "react";
import { useInk } from "../ui/looseleaf/lib/ink/react";
import { buttonRecipe } from "../ui/looseleaf/lib/ink/recipes/button-ink";

// One drawn outline and swipe shared by the two independent buttons.
export function ExampleControl({ children }: { children: ReactNode }) {
  const [direction, setDirection] = useState("left");
  const { hostRef, hostProps, node } = useInk({
    recipe: buttonRecipe,
    params: { variant: "ghost", size: "default", disabled: false, shape: "default" },
    kind: "example-control",
    seed: "example-control",
  });
  return (
    <div
      ref={hostRef}
      {...hostProps}
      className="example-controls"
      data-wipe-direction={direction}
      onPointerOver={(event) => {
        const target = event.target;
        if (target instanceof Element)
          setDirection(target.closest(".example-chevron") ? "right" : "left");
      }}
    >
      {node}
      {children}
    </div>
  );
}
