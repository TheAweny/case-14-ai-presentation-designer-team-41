from engine.visuals import _contrast, _label_colour


def test_a_faint_label_colour_gives_way_to_the_profile_text_colour() -> None:
    palette = {"surface": "FFFFFF", "text": "222222", "text-muted": "E0E0E0"}
    colour = _label_colour("text-muted", palette)
    assert str(colour) == "222222"


def test_a_label_colour_that_reads_is_kept() -> None:
    palette = {"surface": "FFFFFF", "text": "222222", "text-muted": "555555"}
    colour = _label_colour("text-muted", palette)
    assert str(colour) == "555555"
    assert _contrast("555555", "FFFFFF") >= 4.5


def test_the_card_under_the_chart_decides_the_label_colour() -> None:
    # A dark surface role would pass a light grey; the white card the chart sits on does not.
    palette = {"surface": "3A0E5C", "text": "1A1A1A", "text-muted": "D0D0D0"}
    assert str(_label_colour("text-muted", palette, "FFFFFF")) == "1A1A1A"
