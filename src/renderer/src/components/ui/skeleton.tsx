import {t as translate} from "../../../../shared/localization/index.ts";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("skeleton", className)} aria-hidden {...props} />;
}

export function ChatSkeleton() {
  return <div className="chat-skeleton" role="status" aria-label={translate("common.80b90de96ac3")}><span className="sr-only">{translate("common.2c47e8434dfd")}</span>{[0, 1, 2].map(i => <div className="skeleton-message" key={i}><Skeleton className="skeleton-avatar" /><div><Skeleton className="skeleton-name" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line short" /></div></div>)}</div>;
}


