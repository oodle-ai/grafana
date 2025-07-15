package panelcfg

import "github.com/grafana/grafana/packages/grafana-schema/src/schema"

// LogsTablePanelCfg is the panel configuration for the logs table panel
LogsTablePanelCfg: {
	// Panel options
	options: {
		// Show time column
		showTime: bool | *false
		// Show labels column
		showLabels: bool | *false
		// Show common labels
		showCommonLabels: bool | *false
		// Wrap log messages
		wrapLogMessage: bool | *false
		// Prettify JSON in log messages
		prettifyLogMessage: bool | *false
		// Enable log details
		enableLogDetails: bool | *true
		// Show log context toggle
		showLogContextToggle: bool | *false
		// Deduplication strategy
		dedupStrategy: string | *"none"
		// Sort order
		sortOrder: string | *"Descending"
		// Displayed fields for table columns
		displayedFields?: [string]
		// Frame index for multi-frame data
		frameIndex: int | *0
		// Show header
		showHeader: bool | *true
		// Show type icons
		showTypeIcons: bool | *false
		// Footer options
		footer?: {
			// Enable pagination
			enablePagination: bool | *false
			// Show footer
			show: bool | *true
			// Reducer functions
			reducer: [string] | *["count"]
			// Count rows
			countRows: bool | *true
		}
		// Cell height
		cellHeight: string | *"sm"
		// Sort by fields
		sortBy?: [{
			// Display name
			displayName: string
			// Descending order
			desc: bool
		}]
	}
} 