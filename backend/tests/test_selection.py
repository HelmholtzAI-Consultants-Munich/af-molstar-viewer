from __future__ import annotations

import unittest

from backend.selection import canonicalize_target_interface_residues, parse_target_interface_residues


class SelectionTests(unittest.TestCase):
    def test_canonicalizes_multichain_selection(self) -> None:
        self.assertEqual(canonicalize_target_interface_residues("B20-22,A1-10,A12"), "A1-10,A12,B20-22")

    def test_accepts_repeated_chain_ids_on_range_ends(self) -> None:
        self.assertEqual(canonicalize_target_interface_residues("B2-B9,A4-A40"), "A4-40,B2-9")

    def test_rejects_invalid_segment(self) -> None:
        with self.assertRaises(ValueError):
            parse_target_interface_residues("A10-,B2")

    def test_rejects_ranges_that_cross_chains(self) -> None:
        with self.assertRaises(ValueError):
            parse_target_interface_residues("A4-B9")


if __name__ == "__main__":
    unittest.main()
