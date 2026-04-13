package httpbridge

import (
	"testing"

	"github.com/meucontrole-ai/ecosystem-rag/internal/searcher"
	"github.com/stretchr/testify/assert"
)

func TestNewServer(t *testing.T) {
	s := searcher.New(nil, nil)
	server := New(s, "/docs")

	assert.NotNil(t, server)
	assert.Equal(t, s, server.searcher)
	assert.Equal(t, "/docs", server.docsDir)
}

func TestServerStructure(t *testing.T) {
	server := &Server{
		searcher: nil,
		docsDir:  "/some/path",
	}

	assert.Nil(t, server.searcher)
	assert.Equal(t, "/some/path", server.docsDir)
}

func TestServiceEntryStructure(t *testing.T) {
	entry := serviceEntry{
		Name:     "payment-service",
		Category: "services",
		Docs:     []string{"overview", "domain", "apis"},
	}

	assert.Equal(t, "payment-service", entry.Name)
	assert.Equal(t, "services", entry.Category)
	assert.Equal(t, []string{"overview", "domain", "apis"}, entry.Docs)
}

func TestSearchResultStructure(t *testing.T) {
	result := searchResult{
		Service:  "order-service",
		DocType:  "overview",
		Section:  "Introduction",
		FilePath: "/docs/order/overview.md",
		Score:    0.85,
		Content:  "Order service content",
	}

	assert.Equal(t, "order-service", result.Service)
	assert.Equal(t, "overview", result.DocType)
	assert.Equal(t, "Introduction", result.Section)
	assert.Equal(t, "/docs/order/overview.md", result.FilePath)
	assert.Equal(t, float32(0.85), result.Score)
	assert.Equal(t, "Order service content", result.Content)
}

func TestNewServerNilSearcher(t *testing.T) {
	server := New(nil, "/docs")
	assert.NotNil(t, server)
	assert.Nil(t, server.searcher)
}

func TestNewServerEmptyDocsDir(t *testing.T) {
	s := searcher.New(nil, nil)
	server := New(s, "")
	assert.NotNil(t, server)
	assert.Equal(t, "", server.docsDir)
}

func TestPtBrAliases(t *testing.T) {
	// Verify ptBrAliases map has expected entries
	expectedMappings := map[string]string{
		"visao-geral":    "overview",
		"overview":       "visao-geral",
		"arquitetura":    "architecture",
		"architecture":   "arquitetura",
		"dominio":        "domain",
		"domain":         "dominio",
		"eventos":        "events",
		"events":         "eventos",
		"dados":          "data",
		"data":           "dados",
		"impacto":        "impact",
		"impact":         "impacto",
		"integracoes":    "integrations",
		"integrations":   "integracoes",
		"apis-consumidas": "api-consumption",
		"api-consumption": "apis-consumidas",
		"telas":          "screens",
		"screens":        "telas",
	}

	for k, v := range expectedMappings {
		assert.Equal(t, v, ptBrAliases[k], "ptBrAliases[%s] should be %s", k, v)
	}

	// Verify symmetry
	for k, v := range ptBrAliases {
		assert.Equal(t, k, ptBrAliases[v], "ptBrAliases should be symmetric for %s <-> %s", k, v)
	}
}

func TestServerHandlerCreation(t *testing.T) {
	s := searcher.New(nil, nil)
	server := New(s, "/docs")
	handler := server.Handler()
	assert.NotNil(t, handler)
}
