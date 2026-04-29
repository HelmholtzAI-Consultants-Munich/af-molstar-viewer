from __future__ import annotations

import unittest

from backend.selection import canonicalize_selection, parse_selection


class SelectionTests(unittest.TestCase):
    def test_canonicalizes_multichain_selection(self) -> None:
        self.assertEqual(canonicalize_selection("B20-22,A1-10,A12"), "A1-10,A12,B20-22")

    def test_accepts_repeated_chain_ids_on_range_ends(self) -> None:
        self.assertEqual(canonicalize_selection("B2-B9,A4-A40"), "A4-40,B2-9")

    def test_rejects_invalid_segment(self) -> None:
        with self.assertRaises(ValueError):
            parse_selection("A10-,B2")

    def test_rejects_ranges_that_cross_chains(self) -> None:
        with self.assertRaises(ValueError):
            parse_selection("A4-B9")


if __name__ == "__main__":
    unittest.main()
