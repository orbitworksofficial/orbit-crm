/**
 * Database types for the Orbit Works CRM Supabase schema.
 *
 * These mirror `supabase/migrations/*.sql`. Once the project is linked, they can
 * be regenerated with:
 *
 *   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 *
 * Keep this file in sync with the migrations — it is the single source of truth
 * for every typed query in the application.
 */

export type UserRole = 'admin' | 'sales';
export type DealStatus = 'open' | 'won' | 'lost';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

/** Derived status shown in the UI. `overdue` is computed, never stored. */
export type InvoiceDisplayStatus = InvoiceStatus | 'overdue';

export type Organization = {
  id: string;
  name: string;
  slug: string;
  logo_path: string | null;
  website_url: string | null;
  contact_email: string | null;
  invoice_prefix: string;
  invoice_next_number: number;
  proposal_prefix: string;
  proposal_next_number: number;
  default_currency: string;
  default_payment_terms_days: number;
  default_tax_rate: number;
  created_at: string;
  updated_at: string;
}

export type Profile = {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type LeadSource = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export type LeadStatus = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  is_won: boolean;
  is_lost: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export type Service = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  default_rate: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type Contact = {
  id: string;
  organization_id: string;
  full_name: string;
  email: string | null;
  whatsapp_number: string | null;
  company_name: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  lead_source_id: string | null;
  lead_status_id: string | null;
  assigned_to: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  external_ref: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type BillingCycle = 'monthly' | 'quarterly' | 'annual';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

export type Subscription = {
  id: string;
  organization_id: string;
  contact_id: string;
  deal_id: string | null;
  name: string;
  description: string | null;
  amount: number;
  currency: string;
  cycle: BillingCycle;
  status: SubscriptionStatus;
  started_on: string;
  next_billing_date: string;
  ends_on: string | null;
  cancelled_at: string | null;
  reminder_days: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionService = {
  subscription_id: string;
  service_id: string;
  quantity: number;
  rate: number;
};

/** Row of the `lead_scores` view: a 0-100 score plus its components. */
export type LeadScore = {
  id: string;
  organization_id: string;
  score: number;
  score_source: number;
  score_engagement: number;
  score_service: number;
  score_recency: number;
  score_completeness: number;
  is_won: boolean | null;
  is_lost: boolean | null;
};

export type ScoringWeights = {
  organization_id: string;
  weight_source: number;
  weight_engagement: number;
  weight_service: number;
  weight_recency: number;
  weight_completeness: number;
  high_intent_sources: string[];
  updated_at: string;
};

export type AdPlatform = 'meta' | 'google' | 'linkedin';

export type AdCredential = {
  id: string;
  organization_id: string;
  platform: AdPlatform;
  /** Ciphertext. Never send this to the browser. */
  access_token: string;
  refresh_token: string | null;
  account_id: string;
  token_hint: string;
  is_active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdSpendRow = {
  id: string;
  organization_id: string;
  platform: AdPlatform;
  spend_date: string;
  campaign_id: string;
  campaign_name: string;
  utm_campaign: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  platform_conversions: number;
  synced_at: string;
};

export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined';
/** Display status shown in the UI. `expired` is derived, never stored. */
export type ProposalDisplayStatus = ProposalStatus | 'expired';

export type Proposal = {
  id: string;
  organization_id: string;
  contact_id: string;
  deal_id: string | null;
  proposal_number: string;
  title: string;
  status: ProposalStatus;
  summary: string | null;
  terms: string | null;
  issue_date: string;
  valid_until: string;
  responded_at: string | null;
  currency: string;
  tax_rate: number;
  discount_rate: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Row of `proposals_with_status`: proposal plus derived status and money. */
export type ProposalWithStatus = Proposal & {
  display_status: ProposalDisplayStatus;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
};

export type ProposalLineItem = {
  id: string;
  proposal_id: string;
  service_id: string | null;
  name: string;
  description: string | null;
  quantity: number;
  rate: number;
  sort_order: number;
  created_at: string;
};

export type DocumentKind =
  | 'contract' | 'proposal' | 'agreement' | 'invoice_copy' | 'other';

export type CrmDocument = {
  id: string;
  organization_id: string;
  contact_id: string | null;
  deal_id: string | null;
  name: string;
  description: string | null;
  kind: DocumentKind;
  /** Object path in the private bucket. Not a URL — signatures expire. */
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskPriority = 'low' | 'normal' | 'high';

export type Task = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  contact_id: string | null;
  deal_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  completed_at: string | null;
  completed_by: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Row of the `pending_reminders` view: open tasks plus note reminders. */
export type PendingReminder = {
  id: string;
  kind: 'task' | 'note' | 'subscription';
  organization_id: string;
  title: string;
  detail: string | null;
  due_date: string | null;
  priority: string;
  assigned_to: string | null;
  contact_id: string | null;
  deal_id: string | null;
  created_at: string;
};

export type StageColor = 'blue' | 'pink' | 'amber' | 'green' | 'neutral';

export type PipelineStage = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  color: StageColor;
  maps_to_status: DealStatus;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Deal = {
  id: string;
  organization_id: string;
  contact_id: string;
  title: string;
  value: number;
  currency: string;
  status: DealStatus;
  expected_close_date: string | null;
  closed_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  /** Kanban column. Null for a deal never placed on the board. */
  stage_id: string | null;
  /** Order within a column. Fractional, so inserts need no renumbering. */
  board_position: number | null;
  created_at: string;
  updated_at: string;
}

export type Note = {
  id: string;
  organization_id: string;
  contact_id: string | null;
  deal_id: string | null;
  body: string;
  next_action_at: string | null;
  next_action_description: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ActivityLogEntry = {
  id: string;
  organization_id: string;
  contact_id: string | null;
  deal_id: string | null;
  event_type: string;
  description: string;
  metadata: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
}

export type Invoice = {
  id: string;
  organization_id: string;
  contact_id: string;
  deal_id: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  paid_at: string | null;
  currency: string;
  tax_rate: number;
  notes: string | null;
  payment_terms: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Row shape of the `invoices_with_status` view: invoice plus computed money.
 *
 * Declared as an intersection rather than an interface because supabase-js
 * constrains schema entries to `Record<string, unknown>`, which interfaces do
 * not satisfy (they lack an implicit index signature). The same applies to the
 * row types above and the composed shapes below.
 */
export type InvoiceWithStatus = Invoice & {
  display_status: InvoiceDisplayStatus;
  subtotal: number;
  tax_amount: number;
  total: number;
};

export type InvoiceLineItem = {
  id: string;
  invoice_id: string;
  service_id: string | null;
  name: string;
  description: string | null;
  quantity: number;
  rate: number;
  sort_order: number;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* Composed shapes returned by joined queries                                  */
/* -------------------------------------------------------------------------- */

export type ContactWithRelations = Contact & {
  lead_source: Pick<LeadSource, 'id' | 'name' | 'slug'> | null;
  lead_status: Pick<LeadStatus, 'id' | 'name' | 'slug' | 'is_won' | 'is_lost'> | null;
  assignee: Pick<Profile, 'id' | 'full_name'> | null;
  services: Pick<Service, 'id' | 'name'>[];
};

export type DealWithRelations = Deal & {
  contact: Pick<Contact, 'id' | 'full_name' | 'company_name'> | null;
  assignee: Pick<Profile, 'id' | 'full_name'> | null;
  services: Pick<Service, 'id' | 'name'>[];
};

export type InvoiceWithRelations = InvoiceWithStatus & {
  contact: Pick<Contact, 'id' | 'full_name' | 'company_name' | 'email'> | null;
  line_items: InvoiceLineItem[];
};

export type NoteWithAuthor = Note & {
  author: Pick<Profile, 'id' | 'full_name'> | null;
};

/**
 * Table entry shape expected by supabase-js.
 *
 * `Relationships` mirrors the actual foreign keys in the migrations. The client
 * uses it to type embedded resources (`select('*, contact:contacts(...)')`), so
 * an entry missing here surfaces as a "could not find the relation" type error
 * at the call site rather than at runtime.
 */
type TableDef<Row, Rels extends readonly unknown[] = []> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: Rels;
};

/** Declares one foreign key: `Col` on this table → `Ref`.`RefCol`. */
type FK<Name extends string, Col extends string, Ref extends string, RefCol extends string = 'id'> = {
  foreignKeyName: Name;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: [RefCol];
};

type ContactServiceRow = { contact_id: string; service_id: string };
type DealServiceRow = { deal_id: string; service_id: string };

export interface Database {
  public: {
    Tables: {
      organizations: TableDef<Organization>;
      profiles: TableDef<
        Profile,
        [FK<'profiles_organization_id_fkey', 'organization_id', 'organizations'>]
      >;
      lead_sources: TableDef<
        LeadSource,
        [FK<'lead_sources_organization_id_fkey', 'organization_id', 'organizations'>]
      >;
      lead_statuses: TableDef<
        LeadStatus,
        [FK<'lead_statuses_organization_id_fkey', 'organization_id', 'organizations'>]
      >;
      services: TableDef<
        Service,
        [FK<'services_organization_id_fkey', 'organization_id', 'organizations'>]
      >;
      subscriptions: TableDef<
        Subscription,
        [
          FK<'subscriptions_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'subscriptions_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'subscriptions_deal_id_fkey', 'deal_id', 'deals'>,
          FK<'subscriptions_created_by_fkey', 'created_by', 'profiles'>,
        ]
      >;
      subscription_services: TableDef<
        SubscriptionService,
        [
          FK<'subscription_services_subscription_id_fkey', 'subscription_id', 'subscriptions'>,
          FK<'subscription_services_service_id_fkey', 'service_id', 'services'>,
        ]
      >;
      scoring_weights: TableDef<
        ScoringWeights,
        [FK<'scoring_weights_organization_id_fkey', 'organization_id', 'organizations'>]
      >;
      ad_credentials: TableDef<
        AdCredential,
        [
          FK<'ad_credentials_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'ad_credentials_created_by_fkey', 'created_by', 'profiles'>,
        ]
      >;
      ad_spend: TableDef<
        AdSpendRow,
        [FK<'ad_spend_organization_id_fkey', 'organization_id', 'organizations'>]
      >;
      proposals: TableDef<
        Proposal,
        [
          FK<'proposals_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'proposals_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'proposals_deal_id_fkey', 'deal_id', 'deals'>,
          FK<'proposals_created_by_fkey', 'created_by', 'profiles'>,
        ]
      >;
      proposal_line_items: TableDef<
        ProposalLineItem,
        [
          FK<'proposal_line_items_proposal_id_fkey', 'proposal_id', 'proposals'>,
          FK<'proposal_line_items_service_id_fkey', 'service_id', 'services'>,
        ]
      >;
      documents: TableDef<
        CrmDocument,
        [
          FK<'documents_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'documents_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'documents_deal_id_fkey', 'deal_id', 'deals'>,
          FK<'documents_uploaded_by_fkey', 'uploaded_by', 'profiles'>,
        ]
      >;
      tasks: TableDef<
        Task,
        [
          FK<'tasks_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'tasks_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'tasks_deal_id_fkey', 'deal_id', 'deals'>,
          FK<'tasks_assigned_to_fkey', 'assigned_to', 'profiles'>,
          FK<'tasks_created_by_fkey', 'created_by', 'profiles'>,
        ]
      >;
      pipeline_stages: TableDef<
        PipelineStage,
        [FK<'pipeline_stages_organization_id_fkey', 'organization_id', 'organizations'>]
      >;
      contacts: TableDef<
        Contact,
        [
          FK<'contacts_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'contacts_lead_source_id_fkey', 'lead_source_id', 'lead_sources'>,
          FK<'contacts_lead_status_id_fkey', 'lead_status_id', 'lead_statuses'>,
          FK<'contacts_assigned_to_fkey', 'assigned_to', 'profiles'>,
          FK<'contacts_created_by_fkey', 'created_by', 'profiles'>,
        ]
      >;
      contact_services: TableDef<
        ContactServiceRow,
        [
          FK<'contact_services_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'contact_services_service_id_fkey', 'service_id', 'services'>,
        ]
      >;
      deals: TableDef<
        Deal,
        [
          FK<'deals_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'deals_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'deals_assigned_to_fkey', 'assigned_to', 'profiles'>,
          FK<'deals_created_by_fkey', 'created_by', 'profiles'>,
          FK<'deals_stage_id_fkey', 'stage_id', 'pipeline_stages'>,
        ]
      >;
      deal_services: TableDef<
        DealServiceRow,
        [
          FK<'deal_services_deal_id_fkey', 'deal_id', 'deals'>,
          FK<'deal_services_service_id_fkey', 'service_id', 'services'>,
        ]
      >;
      notes: TableDef<
        Note,
        [
          FK<'notes_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'notes_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'notes_deal_id_fkey', 'deal_id', 'deals'>,
          FK<'notes_author_id_fkey', 'author_id', 'profiles'>,
        ]
      >;
      activity_log: TableDef<
        ActivityLogEntry,
        [
          FK<'activity_log_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'activity_log_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'activity_log_deal_id_fkey', 'deal_id', 'deals'>,
          FK<'activity_log_actor_id_fkey', 'actor_id', 'profiles'>,
        ]
      >;
      invoices: TableDef<
        Invoice,
        [
          FK<'invoices_organization_id_fkey', 'organization_id', 'organizations'>,
          FK<'invoices_contact_id_fkey', 'contact_id', 'contacts'>,
          FK<'invoices_deal_id_fkey', 'deal_id', 'deals'>,
          FK<'invoices_created_by_fkey', 'created_by', 'profiles'>,
        ]
      >;
      invoice_line_items: TableDef<
        InvoiceLineItem,
        [
          FK<'invoice_line_items_invoice_id_fkey', 'invoice_id', 'invoices'>,
          FK<'invoice_line_items_service_id_fkey', 'service_id', 'services'>,
        ]
      >;
    };
    Views: {
      invoices_with_status: {
        Row: InvoiceWithStatus;
        Relationships: [];
      };
      proposals_with_status: {
        Row: ProposalWithStatus;
        Relationships: [];
      };
      lead_scores: {
        Row: LeadScore;
        Relationships: [];
      };
      pending_reminders: {
        Row: PendingReminder;
        Relationships: [];
      };
    };
    Functions: {
      next_invoice_number: { Args: { p_organization_id: string }; Returns: string };
      next_proposal_number: { Args: { p_organization_id: string }; Returns: string };
      current_org_id: { Args: Record<string, never>; Returns: string };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      advance_subscription_billing: { Args: { p_subscription_id: string }; Returns: string };
      set_user_role: { Args: { p_user_id: string; p_role: UserRole }; Returns: undefined };
      set_user_active: { Args: { p_user_id: string; p_is_active: boolean }; Returns: undefined };
    };
    Enums: {
      user_role: UserRole;
      deal_status: DealStatus;
      invoice_status: InvoiceStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
