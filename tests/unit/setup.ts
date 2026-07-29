// A real IndexedDB implementation for Node. The data layer is tested against
// actual IDB semantics — transactions, indexes, key ranges — rather than a
// hand-rolled mock that would happily agree with a broken implementation.
import 'fake-indexeddb/auto';
