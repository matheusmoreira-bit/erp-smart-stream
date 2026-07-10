import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Drop-in replacement for shadcn <Dialog> that renders as a bottom-sheet on mobile
 * and a centered dialog on desktop. Subcomponents mirror the shadcn API.
 *
 * Usage: swap `Dialog*` imports for `Responsive*` counterparts. Same children.
 */

interface RootProps extends React.ComponentProps<typeof Dialog> {
  children: React.ReactNode;
}

export function ResponsiveDialog({ children, ...props }: RootProps) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet {...(props as React.ComponentProps<typeof Sheet>)}>{children}</Sheet>
    );
  }
  return <Dialog {...props}>{children}</Dialog>;
}

interface ContentProps extends React.ComponentProps<typeof DialogContent> {
  /** Max sheet height on mobile (default 90vh, use "full" for fullscreen). */
  mobileHeight?: "auto" | "half" | "full";
}

export const ResponsiveDialogContent = React.forwardRef<
  HTMLDivElement,
  ContentProps
>(({ className, children, mobileHeight = "auto", ...props }, ref) => {
  const isMobile = useIsMobile();
  if (isMobile) {
    const heightClass =
      mobileHeight === "full"
        ? "h-[100dvh] max-h-[100dvh] rounded-none"
        : mobileHeight === "half"
        ? "max-h-[60dvh]"
        : "max-h-[90dvh]";
    return (
      <SheetContent
        ref={ref}
        side="bottom"
        className={cn(
          "flex flex-col gap-0 p-0 rounded-t-2xl border-t",
          heightClass,
          className,
        )}
        {...(props as React.ComponentProps<typeof SheetContent>)}
      >
        {/* grab handle */}
        <div className="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {children}
        </div>
      </SheetContent>
    );
  }
  return (
    <DialogContent ref={ref} className={className} {...props}>
      {children}
    </DialogContent>
  );
});
ResponsiveDialogContent.displayName = "ResponsiveDialogContent";

export function ResponsiveDialogHeader(
  props: React.HTMLAttributes<HTMLDivElement>,
) {
  const isMobile = useIsMobile();
  return isMobile ? <SheetHeader {...props} /> : <DialogHeader {...props} />;
}

export function ResponsiveDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <SheetFooter
      className={cn("sticky bottom-0 bg-background pt-3 border-t", className)}
      {...props}
    />
  ) : (
    <DialogFooter className={className} {...props} />
  );
}

export const ResponsiveDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>((props, ref) => {
  const isMobile = useIsMobile();
  return isMobile ? (
    <SheetTitle ref={ref} {...props} />
  ) : (
    <DialogTitle ref={ref} {...props} />
  );
});
ResponsiveDialogTitle.displayName = "ResponsiveDialogTitle";

export const ResponsiveDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>((props, ref) => {
  const isMobile = useIsMobile();
  return isMobile ? (
    <SheetDescription ref={ref} {...props} />
  ) : (
    <DialogDescription ref={ref} {...props} />
  );
});
ResponsiveDialogDescription.displayName = "ResponsiveDialogDescription";
