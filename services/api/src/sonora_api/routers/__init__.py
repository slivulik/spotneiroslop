#: Version prefix lives in each router's own prefix rather than an outer router: FastAPI
#: includes routers lazily and a route's template (used in access logs and metrics) only
#: contains prefixes declared on its own router.
API_V1 = "/v1"
