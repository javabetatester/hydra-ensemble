package qdrant

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewClient(t *testing.T) {
	// Test creating client with localhost (will fail to connect but shouldn't panic)
	// Note: Actual connection tests would require a running Qdrant instance
	client, err := NewClient("localhost:6334")
	// We expect connection to fail since there's no Qdrant running, but client creation should work
	if err != nil {
		// Connection error is expected without a running Qdrant instance
		assert.Contains(t, err.Error(), "qdrant connect")
	} else {
		// If connection succeeds (Qdrant running), close the connection
		assert.NotNil(t, client)
	}
}

func TestPointStructure(t *testing.T) {
	point := Point{
		ID:   "test-point-id",
		Sparse: SparseVector{
			Indices: []uint32{1, 2, 3},
			Values:  []float32{0.1, 0.2, 0.3},
		},
		Payload: map[string]any{
			"service": "payment-service",
			"content": "test content",
		},
	}

	assert.Equal(t, "test-point-id", point.ID)
	assert.Equal(t, []uint32{1, 2, 3}, point.Sparse.Indices)
	assert.Equal(t, []float32{0.1, 0.2, 0.3}, point.Sparse.Values)
	assert.Equal(t, "payment-service", point.Payload["service"])
}

func TestSparseVectorStructure(t *testing.T) {
	sv := SparseVector{
		Indices: []uint32{100, 200, 300},
		Values:  []float32{0.5, 0.6, 0.7},
	}

	assert.Equal(t, []uint32{100, 200, 300}, sv.Indices)
	assert.Equal(t, []float32{0.5, 0.6, 0.7}, sv.Values)
}

func TestSearchResultStructure(t *testing.T) {
	result := SearchResult{
		ID:    "result-1",
		Score: 0.95,
		Payload: map[string]any{
			"service":  "order-service",
			"doc_type": "overview",
		},
	}

	assert.Equal(t, "result-1", result.ID)
	assert.Equal(t, float32(0.95), result.Score)
	assert.Equal(t, "order-service", result.Payload["service"])
	assert.Equal(t, "overview", result.Payload["doc_type"])
}

func TestStrPtr(t *testing.T) {
	s := "test string"
	result := strPtr(s)

	assert.NotNil(t, result)
	assert.Equal(t, "test string", *result)
}

func TestUint64Ptr(t *testing.T) {
	n := uint64(42)
	result := uint64Ptr(n)

	assert.NotNil(t, result)
	assert.Equal(t, uint64(42), *result)
}

func TestStrPtrEmpty(t *testing.T) {
	result := strPtr("")
	assert.NotNil(t, result)
	assert.Equal(t, "", *result)
}

func TestUint64PtrZero(t *testing.T) {
	result := uint64Ptr(0)
	assert.NotNil(t, result)
	assert.Equal(t, uint64(0), *result)
}

func TestClientStructure(t *testing.T) {
	// Test that Client struct has expected fields (without connecting)
	client := &Client{}
	assert.NotNil(t, client)
}

func TestPointWithVariousPayloadTypes(t *testing.T) {
	point := Point{
		ID:   "test-id",
		Sparse: SparseVector{
			Indices: []uint32{1},
			Values:  []float32{0.1},
		},
		Payload: map[string]any{
			"string_val": "hello",
			"bool_val":    true,
			"int_val":     42,
			"float_val":   3.14,
		},
	}

	assert.Equal(t, "hello", point.Payload["string_val"])
	assert.Equal(t, true, point.Payload["bool_val"])
	assert.Equal(t, 42, point.Payload["int_val"])
	assert.Equal(t, 3.14, point.Payload["float_val"])
}

func TestSearchResultWithVariousPayloadTypes(t *testing.T) {
	result := SearchResult{
		ID:    "id",
		Score: 1.0,
		Payload: map[string]any{
			"string_val": "test",
			"bool_val":   false,
			"int_val":    100,
			"float_val":  2.718,
		},
	}

	assert.Equal(t, "test", result.Payload["string_val"])
	assert.Equal(t, false, result.Payload["bool_val"])
	assert.Equal(t, 100, result.Payload["int_val"])
	assert.Equal(t, 2.718, result.Payload["float_val"])
}
