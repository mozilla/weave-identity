"""
    This script removes any existing unit tests that simply load JS
    modules (to check for syntax errors, etc) and auto-generates
    new ones.
"""

import os
import glob

LOADER_TEST_TEMPLATE = """
// This file was automatically generated by makeloadertests.py.
// Please do not modify it.

function run_test() {
  dump("Attempting to load %(jsmodule_url)s\\n");
  Components.utils.import("%(jsmodule_url)s");
}

"""

TEST_FILENAME_PREFIX = "test_load_module_"
MODULES_DIR = "modules"
TESTS_DIR = os.path.join("tests", "unit")
RESOURCE_DIR = "weave"

def remove_old_loader_tests():
    globstr = os.path.join(TESTS_DIR, TEST_FILENAME_PREFIX + "*")
    tests = glob.glob(globstr)
    for filename in tests:
        os.remove(filename)

def make_loader_tests():
    jsmodules = []
    for dirpath, dirnames, filenames in os.walk(MODULES_DIR):
        if ".hg" in dirnames:
            dirnames.remove(".hg")
        jsfilenames = [filename for filename in filenames
                       if filename.endswith(".js")]
        for filename in jsfilenames:
            path = os.path.join(dirpath, filename)
            path = path.replace(MODULES_DIR, "")[1:]
            path = path.replace(os.path.sep, "/")
            jsmodules.append(path)
    for module in jsmodules:
        flat_name = module.replace("/", "_slash_")
        module_url = "resource://%s/%s" % (RESOURCE_DIR, module)
        test_filename = os.path.join(TESTS_DIR,
                                     TEST_FILENAME_PREFIX + flat_name)
        fobj = open(test_filename, "w")
        fobj.write(LOADER_TEST_TEMPLATE % {"jsmodule_url" : module_url})
        fobj.close()

if __name__ == "__main__":
    print __import__("__main__").__doc__
    print "Removing old tests..."
    remove_old_loader_tests()
    print "Creating new tests..."
    make_loader_tests()
    print "Done."
