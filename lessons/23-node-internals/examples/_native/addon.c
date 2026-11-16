// A tiny native addon written against Node-API (the C API), exporting one function: add(a, b).
// This file is a helper for lesson 23 section 14. It is not run by the example checker.
// Build steps are in the README of the lesson. After building, try it with:
//   node lessons/23-node-internals/examples/_native/try-addon.js
#include <node_api.h>

// Called from JavaScript as add(a, b).
static napi_value Add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);  // read the arguments

  double a = 0, b = 0;
  napi_get_value_double(env, args[0], &a);                // JS number -> C double
  napi_get_value_double(env, args[1], &b);

  napi_value result;
  napi_create_double(env, a + b, &result);                // C double -> JS number
  return result;
}

// Runs once, when the addon is loaded. Whatever we put on `exports` is what require() returns.
NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "add", NAPI_AUTO_LENGTH, Add, NULL, &fn);
  napi_set_named_property(env, exports, "add", fn);
  return exports;
}
