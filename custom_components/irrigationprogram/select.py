import logging

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import MATCH_ALL
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.util import slugify

from . import IrrigationData, IrrigationProgram
from .entity import (
    IrrigationProgramEntityMixin,
    program_entity_name,
    program_object_id,
    zone_entity_name,
    zone_object_id,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Initialize config entry. form config flow."""
    data: IrrigationData = config_entry.runtime_data
    unique_id = config_entry.entry_id
    p: IrrigationProgram = config_entry.runtime_data.program
    freq_options = p.freq_options

    entities = []
    if p.freq:
        sensor = Frequency(unique_id, p.name, None, None, freq_options)
        entities.append(sensor)
        config_entry.runtime_data.program.frequency = sensor

    zones = data.zone_data
    for i, zone in enumerate(zones):
        # if zone freq selected or program level not selected
        if zone.freq or not p.freq:
            sensor = Frequency(unique_id, p.name, zone.name, zone.display_name, freq_options)
            entities.append(sensor)
            config_entry.runtime_data.zone_data[i].frequency = sensor
    async_add_entities(entities)


class Frequency(IrrigationProgramEntityMixin, SelectEntity, RestoreEntity):
    _attr_translation_key = "frequency"
    _attr_has_entity_name = True
    _unrecorded_attributes = frozenset({MATCH_ALL})

    def __init__(self, unique_id, pname, name, display_name, freq_options):
        if name:
            self._attr_unique_id = slugify(f"{unique_id}_{name}_frequency")
            self._attr_attribution = f"Irrigation Controller: {pname}, {name}"
            self._init_program_entity(
                unique_id,
                pname,
                entity_name=zone_entity_name(display_name, "frequency"),
                suggested_object_id=zone_object_id(name, "frequency"),
            )
        else:
            self._attr_unique_id = slugify(f"{unique_id}_frequency")
            self._attr_attribution = f"Irrigation Controller: {pname}"
            self._init_program_entity(
                unique_id,
                pname,
                entity_name=program_entity_name("frequency"),
                suggested_object_id=program_object_id("frequency"),
            )

        self._current_option = None
        self._extended_options = ()
        self._options = freq_options
        if freq_options is None:
            self._options = ["1"]

    async def async_added_to_hass(self):
        """HA has started."""
        last_state = await self.async_get_last_state()
        if last_state is None:
            self._current_option = self._options[0]
        else:
            self._current_option = last_state.state

    @property
    def options(self):
        return self._options

    @property
    def current_option(self):
        return self._current_option

    async def async_select_option(self, option: str) -> None:
        """Change the selected option."""
        self._current_option = option
        self.async_write_ha_state()
