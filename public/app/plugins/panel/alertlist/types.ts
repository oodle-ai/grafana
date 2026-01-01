export enum SortOrder {
  AlphaAsc = 1,
  AlphaDesc,
  Importance,
  TimeAsc,
  TimeDesc,
}

export enum GroupMode {
  Default = 'default',
  Custom = 'custom',
}

export enum ViewMode {
  List = 'list',
  Stat = 'stat',
}

export interface StateFilter {
  firing: boolean;
  pending: boolean;
  inactive?: boolean; // backwards compat
  recovering: boolean;
  normal: boolean;
  error: boolean;
  critical?: boolean; // backwards compat - added later
  warn?: boolean; // backwards compat - added later
  noData?: boolean; // backwards compat - added later
}

export interface UnifiedAlertListOptions {
  maxItems: number;
  sortOrder: SortOrder;
  dashboardAlerts: boolean;
  groupMode: GroupMode;
  groupBy: string[];
  alertName: string;
  showInstances: boolean;
  folder: { uid: string; title: string };
  stateFilter: StateFilter;
  alertInstanceLabelFilter: string;
  datasource: string;
  viewMode: ViewMode;
  showInactiveAlerts: boolean;
}
