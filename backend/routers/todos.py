from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/todos", tags=["todos"])


class TodoIn(BaseModel):
    id: str
    text: str
    bucket: str
    goal_id: Optional[str] = None
    done: bool = False
    created_at: str
    sort_order: int = 0


class ReorderIn(BaseModel):
    drag_id: str
    target_id: Optional[str] = None
    above: bool = True
    target_bucket: str


class OutcomesIn(BaseModel):
    week_str: str
    text: str


@router.get("")
async def list_todos(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM todos ORDER BY sort_order, created_at") as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.post("")
async def add_todo(body: TodoIn, user=Depends(get_current_user), db=Depends(get_db)):
    # Append at end of bucket
    async with db.execute(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM todos WHERE bucket = ?", (body.bucket,)
    ) as cur:
        order = (await cur.fetchone())[0]
    await db.execute(
        "INSERT INTO todos (id, text, bucket, goal_id, done, created_at, sort_order) VALUES (?,?,?,?,?,?,?)",
        (body.id, body.text, body.bucket, body.goal_id, int(body.done), body.created_at, order),
    )
    await db.commit()
    return {"ok": True}


@router.patch("/{todo_id}/toggle")
async def toggle_todo(todo_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("UPDATE todos SET done = NOT done WHERE id = ?", (todo_id,))
    await db.commit()
    return {"ok": True}


@router.patch("/{todo_id}/bucket")
async def move_bucket(todo_id: str, body: dict, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("UPDATE todos SET bucket = ? WHERE id = ?", (body["bucket"], todo_id))
    await db.commit()
    return {"ok": True}


@router.delete("/{todo_id}")
async def remove_todo(todo_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
    await db.commit()
    return {"ok": True}


@router.delete("/done/clear")
async def clear_done(user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM todos WHERE done = 1")
    await db.commit()
    return {"ok": True}


@router.post("/reorder")
async def reorder_todo(body: ReorderIn, user=Depends(get_current_user), db=Depends(get_db)):
    # Fetch all todos in target bucket ordered by sort_order
    async with db.execute(
        "SELECT id, sort_order FROM todos WHERE bucket = ? ORDER BY sort_order", (body.target_bucket,)
    ) as cur:
        rows = [dict(r) for r in await cur.fetchall()]

    # Remove the dragged item from the list (it may be in a different bucket)
    items = [r for r in rows if r["id"] != body.drag_id]

    # Find target position
    if body.target_id:
        target_pos = next((i for i, r in enumerate(items) if r["id"] == body.target_id), len(items))
        insert_pos = target_pos if body.above else target_pos + 1
    else:
        insert_pos = len(items)

    items.insert(insert_pos, {"id": body.drag_id})

    # Update bucket + sort order for all affected items
    await db.execute("UPDATE todos SET bucket = ? WHERE id = ?", (body.target_bucket, body.drag_id))
    for i, item in enumerate(items):
        await db.execute("UPDATE todos SET sort_order = ? WHERE id = ?", (i, item["id"]))
    await db.commit()
    return {"ok": True}


@router.get("/outcomes/{week_str}")
async def get_outcomes(week_str: str, user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT text FROM week_outcomes WHERE week_str = ?", (week_str,)) as cur:
        row = await cur.fetchone()
    return {"text": row["text"] if row else ""}


@router.put("/outcomes")
async def set_outcomes(body: OutcomesIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO week_outcomes (week_str, text) VALUES (?, ?) ON CONFLICT(week_str) DO UPDATE SET text = excluded.text",
        (body.week_str, body.text),
    )
    await db.commit()
    return {"ok": True}
