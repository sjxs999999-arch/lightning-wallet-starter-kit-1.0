export type RuleKind='price'|'watchlist'|'portfolio'|'gas'|'health';export type ChannelKind='telegram'|'email'|'webhook';
export type AutomationRule={id:string;name:string;kind:RuleKind;enabled:boolean;schedule_minutes:number;condition:{chain?:string;address?:string;metric?:string;operator?:string;threshold?:number;target?:string};channels:ChannelKind[];next_run_at:string;created_at:string};
export type NotificationChannel={id:string;kind:ChannelKind;name:string;destination:string;enabled:boolean;created_at:string};
export type AutomationJob={id:string;rule_id:string|null;rule_name:string;kind:RuleKind;status:'queued'|'completed'|'failed';attempt:number;dry_run:boolean;detail:Record<string,unknown>;error?:string;created_at:string;finished_at?:string};
export type AutomationOverview={rules:AutomationRule[];channels:NotificationChannel[];jobs:AutomationJob[];retryQueue:number;deliveryEnabled:boolean};
export type Health={status:string;api:string;postgres:string;scheduler:string;readOnlyDefault:boolean;latencyMs:number;checkedAt:string};
