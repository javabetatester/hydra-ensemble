package chunker

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSplitByH2(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		minLen   int // minimum content length to be included
	}{
		{
			name:   "no h2 headers",
			body:   "This is some content without headers.",
			minLen: 1,
		},
		{
			name: "single h2 header",
			body: "Some intro content\n\n## First Section\n\nSection content here",
			minLen: 1, // intro content is less than 20 chars after trim, only section included
		},
		{
			name: "multiple h2 headers",
			body: `Intro

## Section One

Content one

## Section Two

Content two

## Section Three

Content three`,
			minLen: 3, // intro might be included + 3 sections
		},
		{
			name: "h2 at start",
			body: `## First Section

Content`,
			minLen: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sections := splitByH2(tt.body)
			assert.GreaterOrEqual(t, len(sections), tt.minLen, "should have at least %d sections", tt.minLen)
		})
	}
}

func TestSplitByH2SectionTitles(t *testing.T) {
	body := `## Introduction

Intro content

## Overview

Overview content

## Architecture

Arch content`

	sections := splitByH2(body)

	// Titles are NOT lowercased - they preserve original case from regex
	assert.Equal(t, "Introduction", sections[0].title)
	assert.Equal(t, "Overview", sections[1].title)
	assert.Equal(t, "Architecture", sections[2].title)
}

func TestSplitByH2LineStart(t *testing.T) {
	body := `## First

Line 1

## Second

Line 2`

	sections := splitByH2(body)

	// First section starts at line 0
	assert.Equal(t, 0, sections[0].lineStart)
	// Second section starts after first section content
	assert.Greater(t, sections[1].lineStart, 0)
}

func TestStripFrontmatter(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "no frontmatter",
			input:    "Just regular content",
			expected: "Just regular content",
		},
		{
			name:     "with frontmatter",
			input:    "---\ntitle: Test\n---\nContent here",
			expected: "\nContent here",
		},
		{
			name:     "frontmatter at start",
			input:    "---\nid: test\nservice: payment\n---\n\nBody content",
			expected: "\n\nBody content",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripFrontmatter(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCountFrontmatterLines(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int
	}{
		{
			name:     "no frontmatter",
			input:    "Just content",
			expected: 0,
		},
		{
			name:     "single line frontmatter",
			input:    "---\ntitle: Test\n---",
			expected: 3,
		},
		{
			name:     "multi line frontmatter",
			input:    "---\ntitle: Test\nservice: payment\ntype: overview\n---",
			expected: 5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := countFrontmatterLines(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractMetadata(t *testing.T) {
	tests := []struct {
		name        string
		text        string
		path        string
		docsRoot    string
		expectedSvc string
		expectedTyp string
	}{
		{
			name:        "path derived service and type",
			text:        "No frontmatter",
			path:        "/docs/services/payment-service/overview.md",
			docsRoot:    "/docs",
			expectedSvc: "payment-service",
			expectedTyp: "overview",
		},
		{
			name:        "connections type",
			text:        "Content",
			path:        "/docs/services/order-service/_connections.md",
			docsRoot:    "/docs",
			expectedSvc: "order-service",
			expectedTyp: "connections",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			meta := extractMetadata(tt.text, tt.path, tt.docsRoot)
			assert.Equal(t, tt.expectedSvc, meta.Service)
			assert.Equal(t, tt.expectedTyp, meta.Type)
		})
	}
}

func TestExtractMetadataWithFrontmatter(t *testing.T) {
	text := `---
id: payment-service/overview
service: payment-service-core
type: overview
last_verified: 2024-01-15
---

Content here`

	meta := extractMetadata(text, "/docs/services/payment-service/overview.md", "/docs")

	assert.Equal(t, "payment-service/overview", meta.ID)
	assert.Equal(t, "payment-service-core", meta.Service)
	assert.Equal(t, "overview", meta.Type)
	assert.Equal(t, "2024-01-15", meta.LastVerified)
}

func TestExtractMetadataFrontmatterIDOverride(t *testing.T) {
	text := `---
id: custom-id-here
service: different-service
---

Content`

	meta := extractMetadata(text, "/docs/services/original-service/overview.md", "/docs")

	assert.Equal(t, "custom-id-here", meta.ID)
	assert.Equal(t, "different-service", meta.Service)
}

func TestExtractMetadataFallbackID(t *testing.T) {
	text := `---
service: my-service
type: domain
---

Content`

	meta := extractMetadata(text, "/docs/services/my-service/domain.md", "/docs")

	assert.Equal(t, "my-service/domain", meta.ID)
}

func TestIsGenericPadding(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected bool
	}{
		{
			name:     "normal content",
			content:  "This is real documentation content about payments",
			expected: false,
		},
		{
			name:     "placeholder signal - your-service-name",
			content:  "Replace your-service-name with actual service",
			expected: true,
		},
		{
			name:     "placeholder signal - replace with your",
			content:  "Replace with your API key",
			expected: true,
		},
		{
			name:     "placeholder signal - todo fill in",
			content:  "TODO: fill in the configuration",
			expected: true,
		},
		{
			name:     "placeholder signal - placeholder",
			content:  "This is a placeholder value",
			expected: true,
		},
		{
			name:     "case insensitive",
			content:  "YOUR-SERVICE-NAME in uppercase",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isGenericPadding(tt.content)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestChunkID(t *testing.T) {
	id1 := chunkID("/path/to/file.md", "Section Title")
	id2 := chunkID("/path/to/file.md", "Section Title")
	id3 := chunkID("/path/to/file.md", "Different Section")

	// Same inputs should produce same ID
	assert.Equal(t, id1, id2)
	// Different inputs should produce different ID
	assert.NotEqual(t, id1, id3)
	// Should be UUID-like format
	assert.Len(t, id1, 36)
	assert.Contains(t, id1, "-")
}

func TestChunkIDFormat(t *testing.T) {
	id := chunkID("/some/path.md", "Test Section")

	// Check UUID format: xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx
	assert.Regexp(t, `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, id)
}

func TestParseFile(t *testing.T) {
	// Create temp directory and file
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test-service"), 0755)
	require.NoError(t, err)

	// Create test markdown file
	testFile := filepath.Join(docsDir, "services", "test-service", "overview.md")
	content := `---
id: test-service/overview
service: test-service
type: overview
---

## Introduction

This is the introduction content that is longer than 20 characters.

## Overview

This is the overview section with real documentation content.
`

	err = os.WriteFile(testFile, []byte(content), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	require.NoError(t, err)
	assert.NotEmpty(t, chunks)

	// Check first chunk
	assert.Equal(t, "test-service", chunks[0].Service)
	assert.Equal(t, "overview", chunks[0].DocType)
	assert.Contains(t, chunks[0].Section, "Introduction")
	assert.Contains(t, chunks[0].Content, "introduction content")
}

func TestParseFileNonExistent(t *testing.T) {
	chunks, err := ParseFile("/nonexistent/file.md", "/docs")

	assert.Error(t, err)
	assert.Nil(t, chunks)
}

func TestParseFileEmptyContent(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	// Empty file
	testFile := filepath.Join(docsDir, "services", "test", "empty.md")
	err = os.WriteFile(testFile, []byte(""), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	assert.Nil(t, chunks)
	assert.NoError(t, err)
}

func TestParseFileShortContent(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	// Content too short (< 20 chars) - actually ParseFile returns empty slice for short content
	testFile := filepath.Join(docsDir, "services", "test", "short.md")
	err = os.WriteFile(testFile, []byte("Short"), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	// Short content results in empty slice, not nil
	assert.NotNil(t, chunks)
	assert.Empty(t, chunks)
	assert.NoError(t, err)
}

func TestParseFileWithTables(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	testFile := filepath.Join(docsDir, "services", "test", "table.md")
	content := `## Section

| Column 1 | Column 2 |
|----------|----------|
| Value 1  | Value 2  |

Some content here`
	err = os.WriteFile(testFile, []byte(content), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	require.NoError(t, err)
	assert.NotEmpty(t, chunks)
	assert.True(t, chunks[0].HasTable)
}

func TestParseFileWithCode(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	testFile := filepath.Join(docsDir, "services", "test", "code.md")
	content := "## Section\n\nSome text\n\n```go\nfunc main() {}\n```\n\nMore text"
	err = os.WriteFile(testFile, []byte(content), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	require.NoError(t, err)
	assert.NotEmpty(t, chunks)
	assert.True(t, chunks[0].HasCode)
}

func TestParseFileWithMermaid(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	testFile := filepath.Join(docsDir, "services", "test", "mermaid.md")
	content := "## Section\n\nSome text\n\n```mermaid\nflowchart TD\n    A --> B\n```\n\nMore text"
	err = os.WriteFile(testFile, []byte(content), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	require.NoError(t, err)
	assert.NotEmpty(t, chunks)
	assert.True(t, chunks[0].HasMermaid)
}

func TestParseFileWithSourceRef(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	testFile := filepath.Join(docsDir, "services", "test", "source.md")
	content := `## Section

This function handles (source: payment-service-core) for processing.
`
	err = os.WriteFile(testFile, []byte(content), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	require.NoError(t, err)
	assert.NotEmpty(t, chunks)
	assert.True(t, chunks[0].HasSourceRef)
}

func TestParseFileWithGenericPadding(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	testFile := filepath.Join(docsDir, "services", "test", "padding.md")
	content := `## Section

Replace your-service-name with actual value. This content is definitely longer than twenty characters.
`
	err = os.WriteFile(testFile, []byte(content), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	require.NoError(t, err)
	assert.Empty(t, chunks, "Generic padding content should be skipped")
}

func TestParseFileTokenEstimate(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	testFile := filepath.Join(docsDir, "services", "test", "tokens.md")
	content := `## Section

This is some content that should have a token estimate calculated.
`
	err = os.WriteFile(testFile, []byte(content), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	require.NoError(t, err)
	assert.NotEmpty(t, chunks)
	assert.Greater(t, chunks[0].TokenEstimate, 0)
}

func TestParseFileLineStart(t *testing.T) {
	tmpDir := t.TempDir()
	docsDir := filepath.Join(tmpDir, "docs")
	err := os.MkdirAll(filepath.Join(docsDir, "services", "test"), 0755)
	require.NoError(t, err)

	testFile := filepath.Join(docsDir, "services", "test", "lines.md")
	content := `---
front: matter
---

## First Section

First content here

## Second Section

Second content here`

	err = os.WriteFile(testFile, []byte(content), 0644)
	require.NoError(t, err)

	chunks, err := ParseFile(testFile, docsDir)
	require.NoError(t, err)
	assert.NotEmpty(t, chunks)

	// LineStart should be >= 0
	for _, chunk := range chunks {
		assert.GreaterOrEqual(t, chunk.LineStart, 0)
	}
}

func TestChunkStructure(t *testing.T) {
	chunk := Chunk{
		ID:            "test-id",
		Service:       "test-service",
		DocType:       "overview",
		Section:       "Introduction",
		Content:       "Some content",
		FilePath:      "/path/to/file.md",
		LineStart:     10,
		HasTable:      true,
		HasCode:       false,
		HasMermaid:    false,
		HasSourceRef:  true,
		TokenEstimate: 100,
	}

	assert.Equal(t, "test-id", chunk.ID)
	assert.Equal(t, "test-service", chunk.Service)
	assert.Equal(t, "overview", chunk.DocType)
	assert.Equal(t, "Introduction", chunk.Section)
	assert.Equal(t, "Some content", chunk.Content)
	assert.Equal(t, "/path/to/file.md", chunk.FilePath)
	assert.Equal(t, 10, chunk.LineStart)
	assert.True(t, chunk.HasTable)
	assert.False(t, chunk.HasCode)
	assert.False(t, chunk.HasMermaid)
	assert.True(t, chunk.HasSourceRef)
	assert.Equal(t, 100, chunk.TokenEstimate)
}

func TestMetadataStructure(t *testing.T) {
	meta := Metadata{
		ID:           "service/type",
		Service:      "my-service",
		Type:         "domain",
		Tags:         []string{"tag1", "tag2"},
		LinksTo:      []string{"link1"},
		LinkedFrom:   []string{"link2"},
		LastVerified: "2024-01-15",
	}

	assert.Equal(t, "service/type", meta.ID)
	assert.Equal(t, "my-service", meta.Service)
	assert.Equal(t, "domain", meta.Type)
	assert.Equal(t, []string{"tag1", "tag2"}, meta.Tags)
	assert.Equal(t, []string{"link1"}, meta.LinksTo)
	assert.Equal(t, []string{"link2"}, meta.LinkedFrom)
	assert.Equal(t, "2024-01-15", meta.LastVerified)
}
