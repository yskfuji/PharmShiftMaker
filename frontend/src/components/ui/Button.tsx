import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "ui-button inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-canvas transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg hover:bg-primary-hover",
        destructive:
          "bg-danger text-danger-fg hover:bg-danger/90",
        outline:
          "border border-line bg-transparent hover:bg-surface hover:text-fg",
        secondary:
          "bg-surface text-fg hover:bg-surface/80",
        ghost: "hover:bg-surface hover:text-fg",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-4 py-2",
        sm: "min-h-11 rounded-control px-3",
        lg: "min-h-11 rounded-control px-8",
        icon: "min-h-11 min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
