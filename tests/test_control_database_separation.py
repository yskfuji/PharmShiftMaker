import pytest


def test_authority_rejects_same_application_database_with_different_credentials(
    monkeypatch,
):
    from scripts.control_authority import independent_engine

    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://app:one@isolated/pharmshift_control"
    )
    with pytest.raises(ValueError, match="different credentials"):
        independent_engine(
            "postgresql+psycopg://control:two@isolated:5432/pharmshift_control"
        )


def test_witness_rejects_same_control_database_with_different_credentials(monkeypatch):
    from scripts.control_witness import engine

    monkeypatch.setenv(
        "PHARMSHIFT_AUTHORITY_DB_URL",
        "postgresql://authority:one@isolated/pharmshift_witness",
    )
    monkeypatch.setenv(
        "PHARMSHIFT_WITNESS_DB_URL",
        "postgresql+psycopg://witness:two@isolated:5432/pharmshift_witness",
    )
    with pytest.raises(ValueError, match="share"):
        engine()
