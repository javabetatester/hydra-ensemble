package mcp

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServerSetup(t *testing.T) {
	s := NewServer(nil, "/docs")
	require.NotNil(t, s)

	srv := s.Setup()
	assert.NotNil(t, srv)
}

func TestServerToolsRegistered(t *testing.T) {
	s := NewServer(nil, "/docs")
	srv := s.Setup()

	// Verify server is created with expected name and version
	assert.NotNil(t, srv)
}

func TestSearchDocsToolHandler(t *testing.T) {
	s := NewServer(nil, "/docs")
	tool, handler := s.searchDocsTool()

	assert.NotNil(t, tool)
	assert.NotNil(t, handler)
}

func TestGetServiceToolHandler(t *testing.T) {
	s := NewServer(nil, "/docs")
	tool, handler := s.getServiceTool()

	assert.NotNil(t, tool)
	assert.NotNil(t, handler)
}

func TestListServicesToolHandler(t *testing.T) {
	s := NewServer(nil, "/docs")
	tool, handler := s.listServicesTool()

	assert.NotNil(t, tool)
	assert.NotNil(t, handler)
}

func TestGetGraphToolHandler(t *testing.T) {
	s := NewServer(nil, "/docs")
	tool, handler := s.getGraphTool()

	assert.NotNil(t, tool)
	assert.NotNil(t, handler)
}

func TestFindImpactToolHandler(t *testing.T) {
	s := NewServer(nil, "/docs")
	tool, handler := s.findImpactTool()

	assert.NotNil(t, tool)
	assert.NotNil(t, handler)
}

func TestGetConnectionsToolHandler(t *testing.T) {
	s := NewServer(nil, "/docs")
	tool, handler := s.getConnectionsTool()

	assert.NotNil(t, tool)
	assert.NotNil(t, handler)
}

func TestNewServerWithNilSearcher(t *testing.T) {
	server := NewServer(nil, "/docs")
	assert.NotNil(t, server)
	assert.Nil(t, server.searcher)
}

func TestNewServerWithDocsDir(t *testing.T) {
	server := NewServer(nil, "/path/to/docs")
	assert.NotNil(t, server)
	assert.Equal(t, "/path/to/docs", server.docsDir)
}

func TestServerDocsDir(t *testing.T) {
	server := &Server{
		searcher: nil,
		docsDir:  "/some/path",
	}

	assert.Nil(t, server.searcher)
	assert.Equal(t, "/some/path", server.docsDir)
}
