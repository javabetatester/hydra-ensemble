package httpbridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGraphNodeStructure(t *testing.T) {
	node := GraphNode{
		ID:       "order-service",
		Label:    "Order Service",
		Category: "services",
	}

	assert.Equal(t, "order-service", node.ID)
	assert.Equal(t, "Order Service", node.Label)
	assert.Equal(t, "services", node.Category)
}

func TestGraphEdgeStructure(t *testing.T) {
	edge := GraphEdge{
		Source:    "order-service",
		Target:    "payment-service",
		Protocol:  "grpc",
		Direction: "out",
		Purpose:   "process payment",
	}

	assert.Equal(t, "order-service", edge.Source)
	assert.Equal(t, "payment-service", edge.Target)
	assert.Equal(t, "grpc", edge.Protocol)
	assert.Equal(t, "out", edge.Direction)
	assert.Equal(t, "process payment", edge.Purpose)
}

func TestGraphEdgeWithoutPurpose(t *testing.T) {
	edge := GraphEdge{
		Source:    "a",
		Target:    "b",
		Protocol:  "rest",
		Direction: "out",
	}

	assert.Equal(t, "", edge.Purpose)
}

func TestParsedGraphStructure(t *testing.T) {
	nodes := []GraphNode{
		{ID: "svc1", Label: "Service 1", Category: "services"},
		{ID: "svc2", Label: "Service 2", Category: "services"},
	}
	edges := []GraphEdge{
		{Source: "svc1", Target: "svc2", Protocol: "grpc", Direction: "out"},
	}

	graph := ParsedGraph{
		Nodes: nodes,
		Edges: edges,
	}

	assert.Len(t, graph.Nodes, 2)
	assert.Len(t, graph.Edges, 1)
	assert.Equal(t, "svc1", graph.Nodes[0].ID)
	assert.Equal(t, "svc2", graph.Edges[0].Target)
}

func TestParsedGraphEmpty(t *testing.T) {
	graph := ParsedGraph{
		Nodes: []GraphNode{},
		Edges: []GraphEdge{},
	}

	assert.Empty(t, graph.Nodes)
	assert.Empty(t, graph.Edges)
}

func TestIsSkippable(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{"empty", "", true},
		{"comment", "%% this is a comment", true},
		{"classDef", "classDef default fill:#f9f;", true},
		{"class", "class A,B,C myClass", true},
		{"flowchart", "flowchart TD", true},
		{"graph", "graph LR", true},
		{"subgraph", "subgraph title", true},
		{"end", "end", true},
		{"node def", `    OSC["order-service-core"]`, false},
		{"edge plain", `    A --> B`, false},
		{"edge labeled", `    A -->|"label"| B`, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isSkippable(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractMermaidBlock(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expected    string
		expectError bool
	}{
		{
			name:        "valid mermaid block",
			input:       "Some text\n```mermaid\nflowchart TD\n    A --> B\n```\nMore text",
			expected:    "\nflowchart TD\n    A --> B\n",
			expectError: false,
		},
		{
			name:        "no mermaid block",
			input:       "Just regular markdown",
			expectError: true,
		},
		{
			name:        "unclosed mermaid block",
			input:       "```mermaid\nflowchart TD\n    A --> B",
			expectError: true,
		},
		{
			name:        "mermaid at start",
			input:       "```mermaid\ngraph TD\n    X --> Y\n```",
			expected:    "\ngraph TD\n    X --> Y\n",
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := extractMermaidBlock(tt.input)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}

func TestExtractProtocol(t *testing.T) {
	tests := []struct {
		name     string
		label    string
		expected string
	}{
		{"grpc", "gRPC call", "grpc"},
		{"sqs", "SQS queue", "sqs"},
		{"eventbridge", "EventBridge event", "eventbridge"},
		{"sql", "PostgreSQL", "sql"},
		{"pgx", "pgx connection", "sql"},
		{"mongodb", "MongoDB query", "mongodb"},
		{"redis", "Redis pub/sub", "redis"},
		{"smtp", "SMTP email", "smtp"},
		{"oauth", "OAuth2 flow", "oauth2"},
		{"websocket", "WebSocket", "websocket"},
		{"sse", "SSE stream", "websocket"},
		{"rest", "REST API", "rest"},
		{"http", "HTTP endpoint", "rest"},
		{"s3", "S3 bucket", "s3"},
		{"empty", "", "unknown"},
		{"complex", "grpc (gRPc)", "grpc"},
		{"parentheses", "(grpc)", "grpc"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractProtocol(tt.label)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestResolveCategory(t *testing.T) {
	labelToCategory := map[string]string{
		"payment-service": "services",
		"web-frontend":    "apps",
		"deploy-tool":     "tools",
	}

	tests := []struct {
		name       string
		alias      string
		label      string
		cssClass   string
		expected   string
	}{
		{"backend class", "svc", "Service", "backend", "services"},
		{"frontend class", "fe", "Frontend", "frontend", "apps"},
		{"mobile class", "mob", "Mobile", "mobile", "apps"},
		{"desktop class", "desk", "Desktop", "desktop", "apps"},
		{"tool class", "tool", "Tool", "tool", "tools"},
		{"infra class", "db", "Database", "infra", "infrastructure"},
		{"label lookup", "svc", "payment-service", "", "services"},
		{"alias lookup", "web-frontend", "Web FE", "", "apps"},
		{"fallback", "unknown", "Unknown", "", "infrastructure"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := resolveCategory(tt.alias, tt.label, tt.cssClass, labelToCategory)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestResolveCategoryEmptyMap(t *testing.T) {
	// With empty map, should fall back to infrastructure or cssClass
	result := resolveCategory("alias", "label", "backend", map[string]string{})
	assert.Equal(t, "services", result)

	result = resolveCategory("alias", "label", "", map[string]string{})
	assert.Equal(t, "infrastructure", result)
}

func TestParseMermaidGraphEmpty(t *testing.T) {
	graph, err := ParseMermaidGraph("No mermaid here", nil)

	assert.NoError(t, err)
	assert.NotNil(t, graph)
	assert.Empty(t, graph.Nodes)
	assert.Empty(t, graph.Edges)
}

func TestParseMermaidGraphBasic(t *testing.T) {
	markdown := "Some documentation\n\n" +
		"```mermaid\n" +
		"flowchart TD\n" +
		`    OSC["order-service-core"]` + "\n" +
		`    PSC["payment-service-core"]` + "\n" +
		"    OSC --> PSC\n" +
		"```\n\n" +
		"More content"

	services := []serviceEntry{
		{Name: "order-service-core", Category: "services"},
		{Name: "payment-service-core", Category: "services"},
	}

	graph, err := ParseMermaidGraph(markdown, services)

	assert.NoError(t, err)
	assert.NotNil(t, graph)
	assert.NotEmpty(t, graph.Nodes)
	assert.NotEmpty(t, graph.Edges)
}

func TestParseMermaidGraphWithClassAssignment(t *testing.T) {
	markdown := "```mermaid\n" +
		"flowchart TD\n" +
		`    OSC["order-service-core"]` + "\n" +
		`    PSC["payment-service-core"]` + "\n" +
		"    class OSC backend\n" +
		"    class PSC backend\n" +
		"    OSC --> PSC\n" +
		"```"

	graph, err := ParseMermaidGraph(markdown, nil)

	assert.NoError(t, err)
	assert.Len(t, graph.Nodes, 2)
	assert.Len(t, graph.Edges, 1)
}

func TestParseMermaidGraphWithInlineNodes(t *testing.T) {
	markdown := "```mermaid\n" +
		"flowchart TD\n" +
		`    A["First"] --> B["Second"]` + "\n" +
		"```"

	graph, err := ParseMermaidGraph(markdown, nil)

	assert.NoError(t, err)
	assert.NotEmpty(t, graph.Nodes)
}

func TestParseMermaidGraphLabeledEdge(t *testing.T) {
	markdown := "```mermaid\n" +
		"flowchart TD\n" +
		`    A -->|"gRPC call"| B` + "\n" +
		"```"

	graph, err := ParseMermaidGraph(markdown, nil)

	assert.NoError(t, err)
	assert.Len(t, graph.Edges, 1)
	assert.Equal(t, "grpc", graph.Edges[0].Protocol)
}

func TestParseMermaidGraphUnknownNodeCategory(t *testing.T) {
	markdown := "```mermaid\n" +
		"flowchart TD\n" +
		`    UNKNOWN["Unknown Node"]` + "\n" +
		"```"

	graph, err := ParseMermaidGraph(markdown, nil)

	assert.NoError(t, err)
	// Unknown nodes should be marked as infrastructure
	found := false
	for _, n := range graph.Nodes {
		if n.Label == "Unknown Node" {
			assert.Equal(t, "infrastructure", n.Category)
			found = true
		}
	}
	assert.True(t, found, "Should find the Unknown Node")
}

func TestParseMermaidGraphDuplicateNodes(t *testing.T) {
	markdown := "```mermaid\n" +
		"flowchart TD\n" +
		`    A["Label"]` + "\n" +
		`    B["Label"]` + "\n" +
		"    A --> B\n" +
		"```"

	graph, err := ParseMermaidGraph(markdown, nil)

	assert.NoError(t, err)
	// Duplicate labels should be deduplicated
	uniqueLabels := make(map[string]bool)
	for _, n := range graph.Nodes {
		uniqueLabels[n.Label] = true
	}
	assert.Len(t, uniqueLabels, 1, "Should have only one unique label")
}

func TestParseMermaidGraphNilServices(t *testing.T) {
	markdown := "```mermaid\n" +
		"flowchart TD\n" +
		"    A --> B\n" +
		"```"

	graph, err := ParseMermaidGraph(markdown, nil)

	assert.NoError(t, err)
	assert.NotNil(t, graph)
}

func TestParseMermaidGraphEmptyServices(t *testing.T) {
	markdown := "```mermaid\n" +
		"flowchart TD\n" +
		"    A --> B\n" +
		"```"

	graph, err := ParseMermaidGraph(markdown, []serviceEntry{})

	assert.NoError(t, err)
	assert.NotNil(t, graph)
}

func TestParseMermaidGraphMultipleProtocols(t *testing.T) {
	tests := []struct {
		label    string
		expected string
	}{
		{"gRPC", "grpc"},
		{"SQL query", "sql"},
		{"Redis", "redis"},
		{"REST API call", "rest"},
		{"EventBridge rule", "eventbridge"},
	}

	for _, tt := range tests {
		t.Run(tt.label, func(t *testing.T) {
			markdown := "```mermaid\n" +
				"flowchart TD\n" +
				`    A -->|"` + tt.label + `"| B` + "\n" +
				"```"

			graph, err := ParseMermaidGraph(markdown, nil)

			assert.NoError(t, err)
			assert.Equal(t, tt.expected, graph.Edges[0].Protocol)
		})
	}
}
