"""Shared entity helpers for irrigation program entities."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.util import slugify

from .const import DOMAIN


def program_entity_name(label: str) -> str:
    """Return a consistent program-scoped entity name."""
    return f"Program {label}"


def zone_entity_name(zone_name: str, label: str) -> str:
    """Return a consistent zone-scoped entity name."""
    return f"{zone_name} {label}"


def program_object_id(suffix: str) -> str:
    """Return a stable suggested object id for a program-scoped entity."""
    return f"program_{suffix}"


def zone_object_id(zone_name: str, suffix: str) -> str:
    """Return a stable suggested object id for a zone-scoped entity."""
    return f"zone_{slugify(zone_name)}_{suffix}"


class IrrigationProgramEntityMixin:
    """Add common device metadata for irrigation program entities."""

    _device_program_unique_id: str
    _device_program_name: str

    def _init_program_entity(
        self,
        program_unique_id: str,
        program_name: str,
        *,
        entity_name: str | None = None,
        suggested_object_id: str | None = None,
    ) -> None:
        """Initialise shared entity metadata."""
        self._device_program_unique_id = program_unique_id
        self._device_program_name = program_name
        if entity_name is not None:
            self._attr_name = entity_name
            self._attr_has_entity_name = False
        if suggested_object_id is not None:
            self._attr_suggested_object_id = suggested_object_id

    @property
    def device_info(self) -> DeviceInfo:
        """Associate all generated entities with the program device."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._device_program_unique_id)},
            name=self._device_program_name,
            manufacturer="Irrigation Program",
            model="Irrigation Controller",
        )
