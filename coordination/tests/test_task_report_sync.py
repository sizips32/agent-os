import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class TaskReportSync(unittest.TestCase):
    def test_copies_identical(self):
        # Desktop packages its own copy; coordination imports the sibling. Keep them byte-identical.
        desktop = ROOT / "apps/desktop/protected/task_report.py"
        coordination = ROOT / "coordination/helper/task_report.py"
        self.assertEqual(desktop.read_bytes(), coordination.read_bytes())


if __name__ == "__main__":
    unittest.main()
