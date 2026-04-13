package searcher

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestResultStructure(t *testing.T) {
	result := Result{
		Service:       "payment-service",
		DocType:       "overview",
		Section:       "Introduction",
		Content:       "This is the content",
		FilePath:      "/docs/services/payment/overview.md",
		Score:         0.85,
		HasTable:      true,
		HasSourceRef:  false,
		TokenEstimate: 150,
	}

	assert.Equal(t, "payment-service", result.Service)
	assert.Equal(t, "overview", result.DocType)
	assert.Equal(t, "Introduction", result.Section)
	assert.Equal(t, "This is the content", result.Content)
	assert.Equal(t, "/docs/services/payment/overview.md", result.FilePath)
	assert.Equal(t, float32(0.85), result.Score)
	assert.True(t, result.HasTable)
	assert.False(t, result.HasSourceRef)
	assert.Equal(t, 150, result.TokenEstimate)
}

func TestPayloadStr(t *testing.T) {
	tests := []struct {
		name     string
		payload  map[string]any
		key      string
		expected string
	}{
		{
			name:     "string value exists",
			payload:  map[string]any{"service": "payment-service"},
			key:      "service",
			expected: "payment-service",
		},
		{
			name:     "key does not exist",
			payload:  map[string]any{"other": "value"},
			key:      "service",
			expected: "",
		},
		{
			name:     "non-string value",
			payload:  map[string]any{"count": 42},
			key:      "count",
			expected: "",
		},
		{
			name:     "empty payload",
			payload:  map[string]any{},
			key:      "service",
			expected: "",
		},
		{
			name:     "nil value",
			payload:  map[string]any{"service": nil},
			key:      "service",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := payloadStr(tt.payload, tt.key)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestPayloadStrWithInterfaceConversion(t *testing.T) {
	// Test that interface{} conversion works correctly
	payload := map[string]any{
		"string_key": "string_value",
		"int_key":    123,
		"float_key":  45.67,
		"bool_key":   true,
	}

	assert.Equal(t, "string_value", payloadStr(payload, "string_key"))
	assert.Equal(t, "", payloadStr(payload, "int_key"))
	assert.Equal(t, "", payloadStr(payload, "float_key"))
	assert.Equal(t, "", payloadStr(payload, "bool_key"))
}

func TestFormatResultsEmpty(t *testing.T) {
	s := &Searcher{}
	result := s.FormatResults(nil)
	assert.Equal(t, "No results found.", result)

	result = s.FormatResults([]Result{})
	assert.Equal(t, "No results found.", result)
}

func TestFormatResultsSingleResult(t *testing.T) {
	s := &Searcher{}
	results := []Result{
		{
			Service:  "payment-service",
			DocType:  "overview",
			Section:  "Introduction",
			Content:  "Payment service handles all payment processing",
			FilePath: "/docs/payment/overview.md",
			Score:    0.95,
		},
	}

	formatted := s.FormatResults(results)

	assert.Contains(t, formatted, "Result 1")
	assert.Contains(t, formatted, "score: 0.95")
	assert.Contains(t, formatted, "payment-service")
	assert.Contains(t, formatted, "overview")
	assert.Contains(t, formatted, "Introduction")
	assert.Contains(t, formatted, "/docs/payment/overview.md")
	assert.Contains(t, formatted, "Payment service handles all payment processing")
}

func TestFormatResultsMultipleResults(t *testing.T) {
	s := &Searcher{}
	results := []Result{
		{
			Service:  "payment-service",
			DocType:  "overview",
			Section:  "Intro",
			Content:  "Content 1",
			FilePath: "/path/1.md",
			Score:    0.9,
		},
		{
			Service:  "order-service",
			DocType:  "domain",
			Section:  "Orders",
			Content:  "Content 2",
			FilePath: "/path/2.md",
			Score:    0.8,
		},
	}

	formatted := s.FormatResults(results)

	assert.Contains(t, formatted, "Result 1")
	assert.Contains(t, formatted, "Result 2")
	assert.Contains(t, formatted, "0.90")
	assert.Contains(t, formatted, "0.80")
	assert.Contains(t, formatted, "payment-service")
	assert.Contains(t, formatted, "order-service")
}

func TestFormatResultsTruncation(t *testing.T) {
	s := &Searcher{}
	// Create content longer than 2000 chars
	longContent := ""
	for i := 0; i < 2500; i++ {
		longContent += "x"
	}

	results := []Result{
		{
			Service:  "test-service",
			DocType:  "overview",
			Section:  "Test",
			Content:  longContent,
			FilePath: "/path/test.md",
			Score:    0.5,
		},
	}

	formatted := s.FormatResults(results)

	// Should contain truncation marker
	assert.Contains(t, formatted, "...(truncated)")
	// Should not contain full long content
	assert.NotContains(t, formatted, longContent)
}

func TestFormatResultsSeparator(t *testing.T) {
	s := &Searcher{}
	results := []Result{
		{Service: "svc1", DocType: "t1", Section: "s1", Content: "c1", FilePath: "/p1", Score: 0.5},
		{Service: "svc2", DocType: "t2", Section: "s2", Content: "c2", FilePath: "/p2", Score: 0.4},
	}

	formatted := s.FormatResults(results)

	// Check that separator appears between results
	assert.Contains(t, formatted, "---\n\n")
}

func TestNewSearcher(t *testing.T) {
	// Test that New creates a searcher with the given dependencies
	// Note: Without real dependencies, we just verify creation
	s := New(nil, nil)
	assert.NotNil(t, s)
}

func TestSearcherStructure(t *testing.T) {
	s := &Searcher{}
	assert.NotNil(t, s)
}
