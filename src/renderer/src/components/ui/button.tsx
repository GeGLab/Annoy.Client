import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const buttonVariants = cva("ui-button", {
  variants: {
    variant: { default: "ui-button-primary", secondary: "ui-button-secondary", ghost: "ui-button-ghost", destructive: "ui-button-destructive", outline: "ui-button-outline" },
    size: { default: "ui-button-default", sm: "ui-button-sm", icon: "ui-button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp type="button" data-slot="button" className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{loading && <LoaderCircle size={16} className="animate-spin" aria-hidden />}{children}</Comp>;
}
