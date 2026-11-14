"""Owner: LEAD."""
from fastapi import APIRouter

from app.models import MissionPlan, MissionRequest
from app.services import mission

router = APIRouter(prefix="/mission", tags=["mission"])


@router.post("/plan", response_model=MissionPlan)
def plan(req: MissionRequest):
    return mission.plan(req)
