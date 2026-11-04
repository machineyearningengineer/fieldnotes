"use client";
import { Dialog, Tabs } from "radix-ui";
import { BookOpen, GitCompareArrows, X } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "../ui/looseleaf/components/ui/drawer";
import { useSmallScreen } from "../lib/use-small-screen";
import { QuestionComposer } from "./question-composer";
export function ResearchModal({
  open,
  kind,
  onKindChange,
  onClose,
  onReturn,
}: {
  open: boolean;
  kind: "discover" | "compare";
  onKindChange: (kind: "discover" | "compare") => void;
  onClose: () => void;
  onReturn: () => void;
}) {
  const mobile = useSmallScreen();
  const title = mobile ? (
    <DrawerTitle className="composer-title">New research</DrawerTitle>
  ) : (
    <Dialog.Title className="composer-title">New research</Dialog.Title>
  );
  const body = (
    <>
      <div className="composer-header">
        {title}
        <button className="close-button" onClick={onClose} aria-label="Close composer">
          <X size={20} />
        </button>
      </div>
      <Tabs.Root
        value={kind}
        onValueChange={(value) => {
          if (value === "discover" || value === "compare") onKindChange(value);
        }}
      >
        <Tabs.List className="composer-journeys" aria-label="Research journey">
          {(["discover", "compare"] as const).map((value) => (
            <Tabs.Trigger key={value} value={value}>
              {value === "discover" ? <BookOpen size={15} /> : <GitCompareArrows size={15} />}
              <span>{value === "discover" ? "Discover" : "Compare"}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {(["discover", "compare"] as const).map((value) => (
          <Tabs.Content key={value} value={value}>
            <QuestionComposer kind={value} showScenarios={false} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </>
  );
  const restore = (event: Event) => {
    event.preventDefault();
    onReturn();
  };
  if (mobile)
    return (
      <Drawer
        open={open}
        direction="bottom"
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
        shouldScaleBackground={false}
      >
        <DrawerContent
          className="composer-sheet"
          edge="cut"
          stock="slip"
          aria-describedby={undefined}
          onCloseAutoFocus={restore}
        >
          <span className="sheet-handle" aria-hidden="true" />
          {body}
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="composer-overlay" />
        <Dialog.Content
          className="composer-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={restore}
        >
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
