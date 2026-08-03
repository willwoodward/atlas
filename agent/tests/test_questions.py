"""
Human-in-the-loop pause and resume.

The property under test is that a run can block on a question and continue with
its context intact, and — just as important — that it can never block forever on
one nobody can answer.
"""
import asyncio

import pytest

import progress
import questions



@pytest.fixture
def queue():
    q = asyncio.Queue()
    progress.set_progress_queue(q)
    yield q
    progress.set_progress_queue(None)


@pytest.fixture(autouse=True)
def _clean_registry():
    yield
    questions._pending.clear()
    questions.set_run_id(None)


class TestAskAndAnswer:
    async def test_the_question_is_emitted_and_the_call_blocks(self, queue):
        questions.set_run_id("run-1")
        task = asyncio.create_task(questions.ask_user("Which branch?", ["a", "b"]))
        await asyncio.sleep(0.05)

        event = queue.get_nowait()
        assert event["type"] == "question"
        assert event["question"] == "Which branch?"
        assert event["options"] == ["a", "b"]
        assert not task.done(), "the agent must still be parked on the question"
        assert questions.pending_count("run-1") == 1

        questions.deliver("run-1", event["questionId"], "a")
        assert await asyncio.wait_for(task, timeout=2) == "a"

    async def test_the_answer_is_echoed_back_to_the_ui(self, queue):
        questions.set_run_id("run-1")
        task = asyncio.create_task(questions.ask_user("Why?"))
        await asyncio.sleep(0.05)
        qid = queue.get_nowait()["questionId"]

        questions.deliver("run-1", qid, "because")
        await asyncio.wait_for(task, timeout=2)

        echo = queue.get_nowait()
        assert echo["type"] == "question_answered"
        assert echo["answer"] == "because"

    async def test_the_registry_is_cleaned_up(self, queue):
        questions.set_run_id("run-1")
        task = asyncio.create_task(questions.ask_user("Q"))
        await asyncio.sleep(0.05)
        questions.deliver("run-1", queue.get_nowait()["questionId"], "a")
        await asyncio.wait_for(task, timeout=2)
        assert questions.pending_count("run-1") == 0
        assert "run-1" not in questions._pending

    async def test_options_are_capped_and_blanks_dropped(self, queue):
        questions.set_run_id("run-1")
        task = asyncio.create_task(questions.ask_user("Q", ["a", "", None, "b"] + [f"o{i}" for i in range(8)]))
        await asyncio.sleep(0.05)
        event = queue.get_nowait()
        assert "" not in event["options"]
        assert None not in event["options"]
        assert len(event["options"]) <= 6
        questions.deliver("run-1", event["questionId"], "a")
        await asyncio.wait_for(task, timeout=2)


class TestMisdirectedAnswers:
    async def test_an_unknown_question_id_is_not_delivered(self, queue):
        questions.set_run_id("run-1")
        task = asyncio.create_task(questions.ask_user("Q"))
        await asyncio.sleep(0.05)
        queue.get_nowait()

        assert questions.deliver("run-1", "wrong-id", "x") is False
        assert not task.done()

        questions.deliver("run-1", next(iter(questions._pending["run-1"])), "right")
        await asyncio.wait_for(task, timeout=2)

    async def test_an_answer_for_another_run_is_not_delivered(self):
        assert questions.deliver("no-such-run", "q", "x") is False

    async def test_answering_twice_is_rejected_the_second_time(self, queue):
        questions.set_run_id("run-1")
        task = asyncio.create_task(questions.ask_user("Q"))
        await asyncio.sleep(0.05)
        qid = queue.get_nowait()["questionId"]

        assert questions.deliver("run-1", qid, "first") is True
        await asyncio.wait_for(task, timeout=2)
        assert questions.deliver("run-1", qid, "second") is False


class TestCannotHangForever:
    async def test_a_question_with_no_run_returns_immediately(self):
        """Nobody could ever answer it, so hanging for hours would be a bug."""
        questions.set_run_id(None)
        answer = await asyncio.wait_for(questions.ask_user("Q"), timeout=2)
        assert "no interactive session" in answer.lower()
        assert "best judgement" in answer.lower()

    async def test_a_timeout_tells_the_agent_to_proceed_and_say_so(self, queue, monkeypatch):
        monkeypatch.setattr(questions, "ANSWER_TIMEOUT", 0.1)
        questions.set_run_id("run-1")

        answer = await asyncio.wait_for(questions.ask_user("Q"), timeout=3)
        assert "did not answer" in answer.lower()
        assert "assumed" in answer.lower()

        types = []
        while not queue.empty():
            types.append(queue.get_nowait()["type"])
        assert "question_timeout" in types

    async def test_cancelling_a_run_releases_every_waiting_question(self, queue):
        questions.set_run_id("run-1")
        first = asyncio.create_task(questions.ask_user("A"))
        second = asyncio.create_task(questions.ask_user("B"))
        await asyncio.sleep(0.05)
        assert questions.pending_count("run-1") == 2

        questions.cancel_run("run-1")
        await asyncio.sleep(0.05)

        for task in (first, second):
            with pytest.raises(asyncio.CancelledError):
                await task
        assert questions.pending_count("run-1") == 0


class TestRunIsolation:
    async def test_two_runs_do_not_see_each_other_s_questions(self, queue):
        questions.set_run_id("run-A")
        task_a = asyncio.create_task(questions.ask_user("A?"))
        await asyncio.sleep(0.05)
        qid_a = queue.get_nowait()["questionId"]

        # An answer addressed to another run must not resolve this one.
        assert questions.deliver("run-B", qid_a, "wrong") is False
        assert not task_a.done()

        questions.deliver("run-A", qid_a, "right")
        assert await asyncio.wait_for(task_a, timeout=2) == "right"


class TestProgressIsBestEffort:
    def test_emitting_without_a_queue_does_not_raise(self):
        progress.set_progress_queue(None)
        progress.emit({"type": "anything"})  # must not raise

    def test_a_broken_queue_does_not_take_down_the_run(self):
        class Broken:
            def put_nowait(self, item):
                raise RuntimeError("queue is closed")

        progress.set_progress_queue(Broken())
        progress.emit({"type": "anything"})  # must not raise
