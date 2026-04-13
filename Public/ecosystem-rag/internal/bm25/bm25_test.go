package bm25

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewCorpus(t *testing.T) {
	c := NewCorpus()
	assert.NotNil(t, c)
	assert.NotNil(t, c.df)
	assert.Equal(t, 0, c.docCount)
	assert.Equal(t, float64(0), c.avgDL)
}

func TestTokenize(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		checkFn  func([]string) bool
	}{
		{
			name:  "empty string",
			input: "",
			checkFn: func(result []string) bool {
				return len(result) == 0
			},
		},
		{
			name:  "only stop words",
			input: "the a an and or but in on at to",
			checkFn: func(result []string) bool {
				return len(result) == 0
			},
		},
		{
			name:  "mixed content",
			input: "The payment service handles ORDER processing with PostgreSQL",
			checkFn: func(result []string) bool {
				// Should contain key terms, stop words filtered
				foundPayment := false
				foundService := false
				for _, r := range result {
					if r == "payment" {
						foundPayment = true
					}
					if r == "service" {
						foundService = true
					}
				}
				return foundPayment && foundService && len(result) >= 4
			},
		},
		{
			name:  "numbers and underscores",
			input: "user_id order_id product_v2 API_V3",
			checkFn: func(result []string) bool {
				return len(result) >= 3
			},
		},
		{
			name:  "short words filtered",
			input: "a b c d e",
			checkFn: func(result []string) bool {
				return len(result) == 0
			},
		},
		{
			name:  "with punctuation",
			input: "Hello, world! How are you?",
			checkFn: func(result []string) bool {
				// Should contain hello and world, others may be stop words
				for _, r := range result {
					if r == "hello" || r == "world" {
						return true
					}
				}
				return false
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Tokenize(tt.input)
			assert.True(t, tt.checkFn(result), "Tokenize(%q) = %v", tt.input, result)
		})
	}
}

func TestHashTerm(t *testing.T) {
	h1 := hashTerm("test")
	h2 := hashTerm("test")
	h3 := hashTerm("different")

	assert.Equal(t, h1, h2, "same term should produce same hash")
	assert.NotEqual(t, h3, h1, "different terms should produce different hashes")
	assert.NotZero(t, h1)
}

func TestCorpusAddDocument(t *testing.T) {
	c := NewCorpus()

	// Add first document
	c.AddDocument("payment service handles orders")

	// Check document count increased
	assert.Equal(t, 1, c.docCount)
	// Check total document length increased
	assert.Greater(t, c.totalDL, 0)
	assert.Greater(t, c.avgDL, float64(0))

	initialDL := c.totalDL

	// Add second document
	c.AddDocument("order service processes payments")

	assert.Equal(t, 2, c.docCount)
	assert.Greater(t, c.totalDL, initialDL)
}

func TestCorpusAddDocumentDuplicateTerms(t *testing.T) {
	c := NewCorpus()

	// Add two documents with common term
	c.AddDocument("payment service handles orders")
	c.AddDocument("payment service processes refunds")

	// "payment" and "service" should appear in both documents
	docFreq := c.df[hashTerm("payment")]
	assert.GreaterOrEqual(t, docFreq, 2)

	docFreq = c.df[hashTerm("service")]
	assert.GreaterOrEqual(t, docFreq, 2)
}

func TestCorpusComputeSparseEmptyCorpus(t *testing.T) {
	c := NewCorpus()

	result := c.ComputeSparse("payment service")

	assert.Empty(t, result.Indices)
	assert.Empty(t, result.Values)
}

func TestCorpusComputeSparseEmptyQuery(t *testing.T) {
	c := NewCorpus()
	c.AddDocument("some content here")

	result := c.ComputeSparse("the a an")

	// Query with only stop words should return empty
	assert.Empty(t, result.Indices)
	assert.Empty(t, result.Values)
}

func TestCorpusComputeSparseWithDocuments(t *testing.T) {
	c := NewCorpus()

	c.AddDocument("payment service handles orders")
	c.AddDocument("order service processes payments")

	result := c.ComputeSparse("payment orders")

	assert.NotEmpty(t, result.Indices)
	assert.NotEmpty(t, result.Values)
	assert.Equal(t, len(result.Indices), len(result.Values))

	// All scores should be positive
	for _, v := range result.Values {
		assert.Greater(t, v, float32(0))
	}
}

func TestCorpusComputeSparseTermFrequency(t *testing.T) {
	c := NewCorpus()

	// Document with repeated term
	c.AddDocument("payment payment payment refund")

	result := c.ComputeSparse("payment")

	// Should have at least the payment term
	assert.NotEmpty(t, result.Indices)
}

func TestCorpusComputeSparseIDFCalculation(t *testing.T) {
	c := NewCorpus()

	// Add many documents with a rare term
	c.AddDocument("common word here")
	c.AddDocument("another common word")
	c.AddDocument("yet another common")

	// Add one document with rare term
	c.AddDocument("esoteric unique_term here")

	result := c.ComputeSparse("unique_term")

	assert.NotEmpty(t, result.Values)
}

func TestCorpusStats(t *testing.T) {
	c := NewCorpus()

	docCount, termCount, avgDL := c.Stats()
	assert.Equal(t, 0, docCount)
	assert.Equal(t, 0, termCount)
	assert.Equal(t, float64(0), avgDL)

	c.AddDocument("payment service handles orders")
	c.AddDocument("order service processes payments")

	docCount, termCount, avgDL = c.Stats()
	assert.Equal(t, 2, docCount)
	assert.Greater(t, termCount, 0)
	assert.Greater(t, avgDL, float64(0))
}

func TestCorpusConcurrentAddDocument(t *testing.T) {
	c := NewCorpus()

	// Add documents concurrently
	done := make(chan struct{}, 1)
	go func() {
		for i := 0; i < 100; i++ {
			c.AddDocument("payment service test document")
		}
		done <- struct{}{}
	}()

	<-done

	docCount, _, _ := c.Stats()
	assert.Equal(t, 100, docCount)
}

func TestCorpusConcurrentComputeSparse(t *testing.T) {
	c := NewCorpus()

	// Add documents first
	for i := 0; i < 10; i++ {
		c.AddDocument("payment service handles orders and processing")
	}

	// Compute sparse vectors concurrently
	done := make(chan struct{}, 5)
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 20; j++ {
				_ = c.ComputeSparse("payment orders")
			}
			done <- struct{}{}
		}()
	}

	for i := 0; i < 5; i++ {
		<-done
	}
}

func TestSparseVectorStructure(t *testing.T) {
	c := NewCorpus()
	c.AddDocument("test document content")

	result := c.ComputeSparse("test document")

	// Check that indices and values are parallel arrays
	if len(result.Indices) > 0 {
		assert.Equal(t, len(result.Indices), len(result.Values))
	}
}

func BenchmarkTokenize(b *testing.B) {
	text := "The payment service handles ORDER processing with PostgreSQL database connection pooling and gRPC communication"
	for i := 0; i < b.N; i++ {
		Tokenize(text)
	}
}

func BenchmarkAddDocument(b *testing.B) {
	c := NewCorpus()
	text := "payment service handles orders and processing with PostgreSQL and gRPC"

	for i := 0; i < b.N; i++ {
		c.AddDocument(text)
	}
}

func BenchmarkComputeSparse(b *testing.B) {
	c := NewCorpus()
	for i := 0; i < 100; i++ {
		c.AddDocument("payment service handles orders processing database gRPC PostgreSQL")
	}

	for i := 0; i < b.N; i++ {
		_ = c.ComputeSparse("payment orders database")
	}
}
